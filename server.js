const express = require('express');
const http = require('http');
const socketio = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketio(server);

const PORT = process.env.PORT || 3000;

let game = null; // Variabile per gestire una partita attiva
let spectators = []; // Lista di spettatori

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

// Funzione per resettare il gioco
function resetGame() {
  if (game) {
    game.board = Array(3).fill('').map(() => Array(3).fill(''));
    game.currentPlayer = game.player1;
    game.gameOver = false;
    game.winner = null;
  }
}

// Funzione per inviare aggiornamenti del gioco ai partecipanti e spettatori
function updateGame() {
  if (game) {
    const { board, currentPlayer, player1, player2 } = game;
    io.to(player1.id).emit('updateBoard', { board, currentPlayer: currentPlayer.username });
    io.to(player2.id).emit('updateBoard', { board, currentPlayer: currentPlayer.username });
    // Invia aggiornamenti agli spettatori
    spectators.forEach(spectatorId => {
      io.to(spectatorId).emit('updateBoard', { board, currentPlayer: currentPlayer.username });
    });
  }
}

// Gestione delle connessioni dei client
io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);

  // Ricevi il nome utente e il simbolo del giocatore
  socket.on('setUsernameAndSymbol', ({ username, symbol }) => {
    socket.username = username;
    socket.symbol = symbol;

    console.log(`User ${socket.id} set username as ${username} and symbol as ${symbol}`);

    // Se non c'è una partita attiva, inizia una nuova partita con il giocatore
    if (!game) {
      game = {
        player1: socket,
        player2: null,
        board: Array(3).fill('').map(() => Array(3).fill('')),
        currentPlayer: socket,
        gameOver: false,
        winner: null
      };
      // Invia messaggio al giocatore per informarlo che è il primo giocatore
      socket.emit('gameStart', {
        gameId: socket.id,
        role: 'player1',
        symbol: socket.symbol
      });
    } else if (!game.player2) {
      // Se c'è una partita in corso ma manca un secondo giocatore, unisciti alla partita
      if (symbol !== game.player1.symbol) {
        game.player2 = socket;
        game.currentPlayer = game.player1;

        // Invia messaggi ai giocatori per informarli che la partita è iniziata
        io.to(game.player1.id).emit('gameStart', {
          gameId: socket.id,
          role: 'player1',
          opponentUsername: socket.username,
          opponentSymbol: socket.symbol
        });

        io.to(game.player2.id).emit('gameStart', {
          gameId: socket.id,
          role: 'player2',
          opponentUsername: game.player1.username,
          opponentSymbol: game.player1.symbol
        });

        // Aggiorna la partita e invia notifiche
        updateGame();
      } else {
        // Simbolo già scelto dall'altro giocatore
        socket.emit('symbolUnavailable', game.player1.symbol);
      }
    } else {
      // Giocatori pieni, il nuovo client diventa spettatore
      spectators.push(socket.id);
      socket.emit('spectator', 'You are now a spectator. Please wait for the current game to end.');
    }
  });

  // Ricevi la mossa del giocatore
  socket.on('makeMove', ({ row, col }) => {
    // Verifica che la mossa sia valida
    if (game && game.currentPlayer.id === socket.id && !game.gameOver) {
      if (game.board[row][col] === '') {
        // Aggiorna il tabellone di gioco
        const symbol = game.currentPlayer.symbol;
        game.board[row][col] = symbol;

        const winner = checkWinner(game.board);
        if (winner) {
          game.gameOver = true;
          game.winner = game.currentPlayer.username;
          // Invia notifiche di vittoria
          io.to(game.player1.id).emit('gameOver', { winner: game.winner });
          io.to(game.player2.id).emit('gameOver', { winner: game.winner });
          spectators.forEach(spectatorId => {
            io.to(spectatorId).emit('gameOver', { winner: game.winner });
          });
          resetGame();
        } else if (game.board.flat().every(cell => cell !== '')) {
          // Controlla se la partita è finita in parità
          game.gameOver = true;
          // Invia notifiche di parità
          io.to(game.player1.id).emit('gameOver', { winner: 'draw' });
          io.to(game.player2.id).emit('gameOver', { winner: 'draw' });
          spectators.forEach(spectatorId => {
            io.to(spectatorId).emit('gameOver', { winner: 'draw' });
          });
          resetGame();
        } else {
          // Cambia il giocatore corrente
          game.currentPlayer = game.currentPlayer === game.player1 ? game.player2 : game.player1;
          updateGame();
        }
      }
    }
  });

  // Disconnessione di un client
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    // Rimuovi il giocatore dagli spettatori
    const spectatorIndex = spectators.indexOf(socket.id);
    if (spectatorIndex !== -1) {
      spectators.splice(spectatorIndex, 1);
    } else {
      // Controlla se il client era un giocatore
      if (game && (game.player1.id === socket.id || game.player2.id === socket.id)) {
        delete game;
        io.to(game.id).emit('gameAborted');
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
