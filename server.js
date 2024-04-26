const express = require('express');
const http = require('http');
const socketio = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketio(server);

const PORT = process.env.PORT || 3000;

let games = {};
let waitingPlayer = null;

// Funzione per creare un nuovo gioco
function createGame(player1, player2) {
  const gameId = `${player1.id}-${player2.id}`;
  games[gameId] = {
    player1,
    player2,
    board: Array(3).fill('').map(() => Array(3).fill('')),
    currentPlayer: player1,
    gameOver: false,
    winner: null
  };
  return gameId;
}

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

// Funzione per inviare gli aggiornamenti del gioco
function updateGame(gameId) {
  const game = games[gameId];
  if (game) {
    const { board, currentPlayer } = game;
    const opponentPlayer = currentPlayer === game.player1 ? game.player2 : game.player1;

    io.to(gameId).emit('updateBoard', {
      board,
      currentPlayer: currentPlayer.username,
      opponentPlayer: opponentPlayer.username
    });
  }
}

// Funzione per resettare il gioco
function resetGame(gameId) {
  const game = games[gameId];
  if (game) {
    game.board = Array(3).fill('').map(() => Array(3).fill(''));
    game.currentPlayer = game.player1;
    game.gameOver = false;
    game.winner = null;
  }
}

// Gestione delle connessioni dei client
io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);

  // Ricevi il nome utente del giocatore
  socket.on('setUsername', (username) => {
    socket.username = username;
    console.log(`User ${socket.id} set username as ${username}`);

    // Se c'è un giocatore in attesa, crea un nuovo gioco
    if (waitingPlayer) {
      const gameId = createGame(waitingPlayer, socket);
      waitingPlayer.gameId = gameId;
      socket.gameId = gameId;
      io.to(waitingPlayer.id).emit('gameStart', { gameId, username: socket.username, symbol: 'O' });
      io.to(socket.id).emit('gameStart', { gameId, username: waitingPlayer.username, symbol: 'X' });
      waitingPlayer = null;
    } else {
      // Se non c'è nessun giocatore in attesa, metti il giocatore in attesa
      waitingPlayer = socket;
    }
  });

  // Ricevi la mossa del giocatore
  socket.on('makeMove', ({ gameId, row, col }) => {
    const game = games[gameId];

    // Verifica che la mossa sia valida
    if (game && game.currentPlayer.id === socket.id && !game.gameOver) {
      if (game.board[row][col] === '') {
        // Aggiorna il tabellone di gioco
        const symbol = game.currentPlayer === game.player1 ? 'X' : 'O';
        game.board[row][col] = symbol;

        const winner = checkWinner(game.board);
        if (winner) {
          game.gameOver = true;
          game.winner = game.currentPlayer.username;
          io.to(gameId).emit('gameOver', { winner: game.winner });
          resetGame(gameId);
        } else if (game.board.flat().every(cell => cell !== '')) {
          // Controlla se la partita è finita in parità
          game.gameOver = true;
          io.to(gameId).emit('gameOver', { winner: 'draw' });
          resetGame(gameId);
        } else {
          // Cambia il giocatore corrente
          game.currentPlayer = game.currentPlayer === game.player1 ? game.player2 : game.player1;
          updateGame(gameId);
        }
      }
    }
  });

  // Disconnessione di un client
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    if (waitingPlayer && waitingPlayer.id === socket.id) {
      waitingPlayer = null;
    } else {
      for (const gameId in games) {
        const game = games[gameId];
        if (game && (game.player1.id === socket.id || game.player2.id === socket.id)) {
          delete games[gameId];
          io.to(gameId).emit('gameAborted');
        }
      }
    }
  });
});

// Configurazione delle route per il server
app.use(express.static('public'));

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
