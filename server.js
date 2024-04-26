const express = require('express');
const http = require('http');
const socketio = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketio(server);

const PORT = process.env.PORT || 3000;

let game = null;
let spectators = [];

// Funzione per controllare se c'è un vincitore
function checkWinner(board) {
  const winningCombinations = [
    // Righe
    [[0, 0], [0, 1], [0, 2]],
    [[1, 0], [1, 1], [1, 2]],
    [[2, 0], [2, 1], [2, 2]],
    // Colonne
    [[0, 0], [1, 0], [2, 0]],
    [[0, 1], [1, 1], [2, 1]],
    [[0, 2], [1, 2], [2, 2]],
    // Diagonali
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

// Funzione per inviare aggiornamenti di gioco ai giocatori
function updateGame() {
  if (game) {
    const { board, currentPlayer } = game;
    const opponent = currentPlayer === game.player1 ? game.player2 : game.player1;
    io.to(game.player1.id).emit('updateBoard', {
      board,
      currentPlayer: currentPlayer.username,
      symbol: game.symbols.player1
    });
    io.to(game.player2.id).emit('updateBoard', {
      board,
      currentPlayer: currentPlayer.username,
      symbol: game.symbols.player2
    });
    // Invia aggiornamenti agli spettatori
    spectators.forEach(spectatorId => {
      io.to(spectatorId).emit('updateBoard', { board, currentPlayer: currentPlayer.username });
    });
  }
}

// Funzione per resettare la partita
function resetGame() {
  game = null;
  spectators = [];
}

// Gestione delle connessioni dei client
io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);

  // Ricevi il nome utente e il simbolo scelto
  socket.on('setUsernameAndSymbol', ({ username, symbol }) => {
    socket.username = username;
    socket.symbol = symbol;

    console.log(`User ${socket.id} set username as ${username} and symbol as ${symbol}`);

    // Gestisci le connessioni dei giocatori e degli spettatori
    if (!game) {
      // Inizia una nuova partita
      game = {
        player1: socket,
        player2: null,
        board: Array(3).fill('').map(() => Array(3).fill('')),
        currentPlayer: socket,
        gameOver: false,
        symbols: {
          player1: symbol,
          player2: null
        }
      };
      socket.emit('gameStart', { gameId: socket.id, role: 'player1', symbol });
    } else if (!game.player2) {
      // Se c'è un giocatore già in partita, aggiungi il secondo giocatore
      if (symbol === game.symbols.player1) {
        socket.emit('symbolUnavailable', game.symbols.player1);
        return;
      }
      game.player2 = socket;
      game.currentPlayer = game.player1;
      game.symbols.player2 = symbol;

      io.to(game.player1.id).emit('gameStart', {
        gameId: game.id,
        role: 'player1',
        opponentUsername: socket.username,
        opponentSymbol: socket.symbol
      });
      socket.emit('gameStart', {
        gameId: game.id,
        role: 'player2',
        opponentUsername: game.player1.username,
        opponentSymbol: game.symbols.player1
      });
      updateGame();
    } else {
      // Aggiungi il client come spettatore
      spectators.push(socket.id);
      socket.emit('spectator', 'You are now a spectator. Please wait for the current game to end.');
    }
  });

  // Ricevi la mossa del giocatore
  socket.on('makeMove', ({ gameId, row, col }) => {
    if (game && game.currentPlayer.id === socket.id && !game.gameOver) {
      if (game.board[row][col] === '') {
        const symbol = game.currentPlayer === game.player1 ? game.symbols.player1 : game.symbols.player2;
        game.board[row][col] = symbol;

        const winner = checkWinner(game.board);
        if (winner) {
          game.gameOver = true;
          io.to(game.player1.id).emit('gameOver', { winner: game.currentPlayer.username });
          io.to(game.player2.id).emit('gameOver', { winner: game.currentPlayer.username });
          spectators.forEach(spectatorId => {
            io.to(spectatorId).emit('gameOver', { winner: game.currentPlayer.username });
          });
          resetGame();
        } else if (game.board.flat().every(cell => cell !== '')) {
          // Partita in parità
          game.gameOver = true;
          io.to(game.player1.id).emit('gameOver', { winner: 'draw' });
          io.to(game.player2.id).emit('gameOver', { winner: 'draw' });
          spectators.forEach(spectatorId => {
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

  // Gestione della disconnessione dei client
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    // Rimuovi lo spettatore se presente
    const index = spectators.indexOf(socket.id);
    if (index !== -1) {
      spectators.splice(index, 1);
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
app.get('/', function (req, res) {
    res.sendFile(__dirname + '/public/client.html');
});

// Configurazione delle route per il server
app.use(express.static('public'));

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});




