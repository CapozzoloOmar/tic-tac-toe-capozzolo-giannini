// Importiamo i moduli necessari
const express = require("express");
const http = require("http");
const socketio = require("socket.io");

// Configuriamo l'app Express e il server HTTP
const app = express();
const server = http.createServer(app);
const io = socketio(server);

// Porta su cui il server ascolterà
const PORT = process.env.PORT || 3000;

// Stato della partita
let game = null;
let spectatorQueue = []; // Coda di spettatori in attesa

// Funzione per verificare se c'è un vincitore sulla griglia di gioco
function checkWinner(board) {
  const winningCombinations = [
    // Combinazioni vincenti
    [
      [0, 0],
      [0, 1],
      [0, 2],
    ],
    [
      [1, 0],
      [1, 1],
      [1, 2],
    ],
    [
      [2, 0],
      [2, 1],
      [2, 2],
    ],
    [
      [0, 0],
      [1, 0],
      [2, 0],
    ],
    [
      [0, 1],
      [1, 1],
      [2, 1],
    ],
    [
      [0, 2],
      [1, 2],
      [2, 2],
    ],
    [
      [0, 0],
      [1, 1],
      [2, 2],
    ],
    [
      [0, 2],
      [1, 1],
      [2, 0],
    ],
  ];

  for (const [a, b, c] of winningCombinations) {
    if (
      board[a[0]][a[1]] &&
      board[a[0]][a[1]] === board[b[0]][b[1]] &&
      board[a[0]][a[1]] === board[c[0]][c[1]]
    ) {
      return { winner: board[a[0]][a[1]], line: [a, b, c] };
    }
  }
  return null;
}

// Controlla se la partita è finita in pareggio
function isDraw(board) {
  return board.flat().every((cell) => cell !== "");
}

// Aggiorna la partita inviando le informazioni ai giocatori
function updateGame() {
  if (game) {
    const { board, currentPlayer } = game;
    const opponent =
      currentPlayer === game.player1 ? game.player2 : game.player1;

    // Invia aggiornamenti ai giocatori
    io.to(game.player1.id).emit("updateBoard", {
      board,
      currentPlayer: currentPlayer.username,
      yourTurn: currentPlayer.id === game.player1.id,
    });
    io.to(game.player2.id).emit("updateBoard", {
      board,
      currentPlayer: currentPlayer.username,
      yourTurn: currentPlayer.id === game.player2.id,
    });

    // Invia aggiornamenti agli spettatori
    spectatorQueue.forEach((spectatorId) => {
      io.to(spectatorId).emit("updateBoard", {
        board,
        currentPlayer: currentPlayer.username,
      });
    });
  }
}

// Resetta la partita e inizia una nuova partita se ci sono spettatori in coda
function resetGame() {
  game = null;
  // Inizia una nuova partita con i primi due spettatori in coda, se presenti
  if (spectatorQueue.length >= 2) {
    const nextPlayer1 = io.sockets.sockets.get(spectatorQueue.shift());
    const nextPlayer2 = io.sockets.sockets.get(spectatorQueue.shift());
    startGame(nextPlayer1, nextPlayer2);
  }
}

// Funzione per gestire la fine della partita
function endGame(winner, line = null) {
  game.gameOver = true;
  const message = winner === "parità" ? "Parità!" : `Il giocatore ${winner} ha vinto!`;
  const result = { message, winner, line };

  io.to(game.player1.id).emit("gameEnd", result);
  io.to(game.player2.id).emit("gameEnd", result);
  spectatorQueue.forEach((spectatorId) => {
    io.to(spectatorId).emit("gameEnd", result);
  });

  resetGame();
}

// Inizia il gioco assegnando simboli e turni ai giocatori
function startGame(player1, player2) {
  // Il giocatore con X inizia per primo
  const [firstPlayer, secondPlayer] =
    player1.symbol === "X" ? [player1, player2] : [player2, player1];

  game = {
    player1: firstPlayer,
    player2: secondPlayer,
    board: Array(3)
      .fill("")
      .map(() => Array(3).fill("")),
    currentPlayer: firstPlayer,
    gameOver: false,
    winner: null,
    symbols: {
      player1: firstPlayer.symbol,
      player2: secondPlayer.symbol,
    },
  };

  // Invia messaggi ai giocatori per informarli dell'inizio della partita
  io.to(firstPlayer.id).emit("gameStart", {
    gameId: game.id,
    yourSymbol: firstPlayer.symbol,
    opponentSymbol: secondPlayer.symbol,
    currentPlayer: firstPlayer.username,
  });
  io.to(secondPlayer.id).emit("gameStart", {
    gameId: game.id,
    yourSymbol: secondPlayer.symbol,
    opponentSymbol: firstPlayer.symbol,
    currentPlayer: firstPlayer.username,
  });

  // Aggiorna la partita
  updateGame();
}

// Gestione delle connessioni dei client
io.on("connection", (socket) => {
  console.log(`New client connected: ${socket.id}`);

  // Ricevi l'username e il simbolo scelto
  socket.on("setUsernameAndSymbol", ({ username, symbol }) => {
    socket.username = username;
    socket.symbol = symbol;

    console.log(
      `User ${socket.id} set username as ${username} and symbol as ${symbol}`
    );

    // Se non c'è partita attiva, inizia una nuova partita
    if (!game) {
      game = {
        player1: socket,
        player2: null,
        board: Array(3)
          .fill("")
          .map(() => Array(3).fill("")),
        currentPlayer: null,
        gameOver: false,
        winner: null,
        symbols: {
          player1: symbol,
          player2: null,
        },
      };
      // Informa il giocatore che è in attesa di un avversario
      socket.emit("waitingForPlayer");
    } else if (!game.player2) {
      // Se c'è già un giocatore, aggiungi il secondo giocatore
      if (symbol === game.symbols.player1) {
        socket.emit("symbolUnavailable", game.symbols.player1);
        return;
      }

      game.player2 = socket;
      game.currentPlayer = game.player1; // Il giocatore con X inizia per primo

      // Invia messaggi ai giocatori per informarli dell'inizio della partita
      io.to(game.player1.id).emit("gameStart", {
        gameId: game.id,
        yourSymbol: game.symbols.player1,
        opponentSymbol: symbol,
        currentPlayer: game.currentPlayer.username,
      });
      io.to(socket.id).emit("gameStart", {
        gameId: game.id,
        yourSymbol: symbol,
        opponentSymbol: game.symbols.player1,
        currentPlayer: game.currentPlayer.username,
      });

      // Avvia la partita
      startGame(game.player1, game.player2);
    } else {
      // Se la partita è piena, aggiungi il giocatore come spettatore
      spectatorQueue.push(socket.id);
      socket.emit(
        "spectator",
        "You are now a spectator. Please wait for the current game to end."
      );
    }
  });

  // Ricevi la mossa del giocatore
  socket.on("makeMove", ({ gameId, row, col }) => {
    if (game && game.currentPlayer.id === socket.id && !game.gameOver) {
      if (game.board[row][col] === "") {
        // Aggiungi il simbolo del giocatore alla cella
        const symbol = game.currentPlayer.symbol;
        game.board[row][col] = symbol;

        // Verifica se c'è un vincitore
        const winnerInfo = checkWinner(game.board);
        if (winnerInfo) {
          const { winner, line } = winnerInfo;
          endGame(winner, line);
        } else if (isDraw(game.board)) {
          // Controlla se la partita è finita in pareggio
          endGame("parità");
        } else {
          // Cambia il turno del giocatore
          game.currentPlayer =
            game.currentPlayer === game.player1 ? game.player2 : game.player1;
          updateGame();
        }
      }
    }
  });

  // Gestione della disconnessione di un client
  socket.on("disconnect", () => {
    console.log(`Client disconnected: ${socket.id}`);
    // Rimuovi lo spettatore se presente
    const index = spectatorQueue.indexOf(socket.id);
    if (index !== -1) {
      spectatorQueue.splice(index, 1);
    } else if (game) {
      // Verifica se il client era un giocatore nella partita
      if (game.player1 && game.player1.id === socket.id) {
        io.to(game.player2.id).emit("gameAborted");
        resetGame();
      } else if (game.player2 && game.player2.id === socket.id) {
        io.to(game.player1.id).emit("gameAborted");
        resetGame();
      }
    }
  });
});

// Configurazione delle route per il server
app.get("/", (req, res) => {
  res.sendFile(__dirname + "/public/client.html");
});

// Serve i file statici dalla cartella "public"
app.use(express.static("public"));

// Inizia ad ascoltare le richieste sulla porta specificata
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
