const express = require('express');
const http = require('http');
const socketio = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketio(server);

const PORT = process.env.PORT || 3000;

let game = null;
let spectatorQueue = [];

function checkWinner(board) {
    const winningCombinations = [
        [[0, 0], [0, 1], [0, 2]],
        [[1, 0], [1, 1], [1, 2]],
        [[2, 0], [2, 1], [2, 2]],
        [[0, 0], [1, 0], [2, 0]],
        [[0, 1], [1, 1], [2, 1]],
        [[0, 2], [1, 2], [2, 2]],
        [[0, 0], [1, 1], [2, 2]],
        [[0, 2], [1, 1], [2, 0]]
    ];

    for (const combination of winningCombinations) {
        const [a, b, c] = combination;
        if (board[a[0]][a[1]] && board[a[0]][a[1]] === board[b[0]][b[1]] && board[a[0]][a[1]] === board[c[0]][c[1]]) {
            return board[a[0]][a[1]];
        }
    }
    return null;
}

function isDraw(board) {
    return board.flat().every(cell => cell !== '');
}

function updateGame() {
    if (game) {
        const { board, currentPlayer } = game;
        const opponent = currentPlayer === game.player1 ? game.player2 : game.player1;

        // Invia aggiornamenti ai giocatori
        io.to(game.player1.id).emit('updateBoard', {
            board,
            currentPlayer: currentPlayer.username,
            yourTurn: currentPlayer.id === game.player1.id
        });
        io.to(game.player2.id).emit('updateBoard', {
            board,
            currentPlayer: currentPlayer.username,
            yourTurn: currentPlayer.id === game.player2.id
        });

        // Invia aggiornamenti agli spettatori
        spectatorQueue.forEach(spectatorId => {
            io.to(spectatorId).emit('updateBoard', { board, currentPlayer: currentPlayer.username });
        });
    }
}

function resetGame() {
    game = null;
    // Inizia una nuova partita con i primi due spettatori in coda, se presenti
    if (spectatorQueue.length >= 2) {
        const nextPlayer1 = io.sockets.sockets.get(spectatorQueue.shift());
        const nextPlayer2 = io.sockets.sockets.get(spectatorQueue.shift());
        startGame(nextPlayer1, nextPlayer2);
    }
}

function startGame(player1, player2) {
    // Assicurati che il giocatore con "X" inizi per primo
    let firstPlayer, secondPlayer;
    if (player1.symbol === 'X') {
        firstPlayer = player1;
        secondPlayer = player2;
    } else {
        firstPlayer = player2;
        secondPlayer = player1;
    }

    game = {
        player1: firstPlayer,
        player2: secondPlayer,
        board: Array(3).fill('').map(() => Array(3).fill('')),
        currentPlayer: firstPlayer, // Il giocatore con "X" parte per primo
        gameOver: false,
        symbols: {
            player1: 'X',
            player2: 'O'
        }
    };

    // Invia messaggi di avvio della partita ai giocatori
    io.to(firstPlayer.id).emit('gameStart', {
        gameId: game.id,
        yourSymbol: 'X',
        opponentSymbol: 'O',
        currentPlayer: firstPlayer.username
    });
    io.to(secondPlayer.id).emit('gameStart', {
        gameId: game.id,
        yourSymbol: 'O',
        opponentSymbol: 'X',
        currentPlayer: firstPlayer.username
    });

    // Aggiorna la partita
    updateGame();
}

io.on('connection', (socket) => {
    console.log(`New client connected: ${socket.id}`);

    // Ricevi il nome utente e il simbolo scelto
    socket.on('setUsernameAndSymbol', ({ username, symbol }) => {
        socket.username = username;
        socket.symbol = symbol;

        console.log(`User ${socket.id} set username as ${username} and symbol as ${symbol}`);

        // Se la partita non è attiva, inizia una nuova partita con il giocatore
        if (!game) {
            game = {
                player1: socket,
                player2: null,
                board: Array(3).fill('').map(() => Array(3).fill('')),
                currentPlayer: null,
                gameOver: false,
                winner: null,
                symbols: {
                    player1: symbol,
                    player2: null
                }
            };
            // Informa il giocatore che è in attesa di un avversario
            socket.emit('waitingForPlayer');
        } else if (!game.player2) {
            // Se c'è una partita attiva, aggiungi il secondo giocatore
            // Verifica che i simboli siano differenti
            if (symbol === game.symbols.player1) {
                socket.emit('symbolUnavailable', game.symbols.player1);
                return;
            }

            // Assegna il secondo giocatore alla partita
            game.player2 = socket;
            game.currentPlayer = Math.random() < 0.5 ? game.player1 : game.player2;
            game.symbols = {
                player1: game.player1.symbol,
                player2: symbol
            };

            // Invia messaggi ai giocatori per informarli che la partita è iniziata
            io.to(game.player1.id).emit('gameStart', {
                gameId: game.id,
                role: 'player1',
                opponentUsername: socket.username,
                opponentSymbol: symbol
            });
            socket.emit('gameStart', {
                gameId: game.id,
                role: 'player2',
                opponentUsername: game.player1.username,
                opponentSymbol: game.symbols.player1
            });

            // Avvia la partita
            startGame(game.player1, game.player2);
        } else {
            // Aggiungi il client come spettatore
            spectatorQueue.push(socket.id);
            socket.emit('spectator', 'You are now a spectator. Please wait for the current game to end.');
        }
    });

    // Ricevi la mossa del giocatore
    socket.on('makeMove', ({ gameId, row, col }) => {
        if (game && game.currentPlayer.id === socket.id && !game.gameOver) {
            if (game.board[row][col] === '') {
                // Aggiungi il simbolo del giocatore alla cella
                const symbol = game.currentPlayer.symbol;
                game.board[row][col] = symbol;

                // Verifica se c'è un vincitore
                const winner = checkWinner(game.board);
                if (winner) {
                    game.gameOver = true;
                    io.to(game.player1.id).emit('gameOver', { winner: game.currentPlayer.username });
                    io.to(game.player2.id).emit('gameOver', { winner: game.currentPlayer.username });
                    spectatorQueue.forEach(spectatorId => {
                        io.to(spectatorId).emit('gameOver', { winner: game.currentPlayer.username });
                    });
                    resetGame();
                } else if (isDraw(game.board)) {
                    // Controlla se la partita è finita in pareggio
                    game.gameOver = true;
                    io.to(game.player1.id).emit('gameOver', { winner: 'draw' });
                    io.to(game.player2.id).emit('gameOver', { winner: 'draw' });
                    spectatorQueue.forEach(spectatorId => {
                        io.to(spectatorId).emit('gameOver', { winner: 'draw' });
                    });
                    resetGame();
                } else {
                    // Cambia il turno del giocatore
                    game.currentPlayer = game.currentPlayer === game.player1 ? game.player2 : game.player1;
                    updateGame();
                }
            }
        }
    });

    // Disconnessione di un client
    socket.on('disconnect', () => {
        console.log(`Client disconnected: ${socket.id}`);
        // Rimuovi lo spettatore se presente
        const index = spectatorQueue.indexOf(socket.id);
        if (index !== -1) {
            spectatorQueue.splice(index, 1);
        } else if (game) {
            // Verifica se il client era un giocatore in partita
            if (game.player1 && game.player1.id === socket.id) {
                io.to(game.player2.id).emit('gameAborted');
                resetGame();
            } else if (game.player2 && game.player2.id === socket.id) {
                io.to(game.player1.id).emit('gameAborted');
                resetGame();
            }
        }
    });
});

// Configurazione delle route per il server
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/public/client.html');
});

app.use(express.static('public'));

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
