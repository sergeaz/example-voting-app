var express = require('express'),
    async = require('async'),
    { Pool } = require('pg'),
    cookieParser = require('cookie-parser'),
    fs = require('fs'),
    path = require('path'),
    app = express(),
    server = require('http').Server(app),
    io = require('socket.io')(server);

var port = process.env.PORT || 4000;

io.on('connection', function (socket) {

  socket.emit('message', { text : 'Welcome!' });

  socket.on('subscribe', function (data) {
    socket.join(data.channel);
  });
});

var pool = new Pool({
  connectionString: 'postgres://postgres:postgres@db/postgres'
});

async.retry(
  {times: 1000, interval: 1000},
  function(callback) {
    pool.connect(function(err, client, done) {
      if (err) {
        console.error("Waiting for db");
      }
      callback(err, client);
    });
  },
  function(err, client) {
    if (err) {
      return console.error("Giving up");
    }
    console.log("Connected to db");
    getVotes(client);
  }
);

function getVotes(client) {
  client.query('SELECT vote, COUNT(id) AS count FROM votes GROUP BY vote', [], function(err, result) {
    if (err) {
      console.error("Error performing query: " + err);
    } else {
      var votes = collectVotesFromResult(result);
      io.sockets.emit("scores", JSON.stringify(votes));
    }

    setTimeout(function() {getVotes(client) }, 1000);
  });
}

function collectVotesFromResult(result) {
  var votes = {a: 0, b: 0};

  result.rows.forEach(function (row) {
    votes[row.vote] = parseInt(row.count);
  });

  return votes;
}

app.use(cookieParser());
app.use(express.urlencoded());
app.use(express.static(__dirname + '/views', { index: false }));

app.get('/', function (req, res) {
  const indexPath = path.join(__dirname, 'views', 'index.html');
  fs.readFile(indexPath, 'utf8', function(err, data) {
    if (err) return res.status(500).send('Error loading page');

    const optionA = process.env.OPTION_A ?? 'Fake A';
    const optionB = process.env.OPTION_B ?? 'Fake B';
    // simple HTML-escape to avoid accidental injection
    const escapeHtml = (str) =>
      String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    const out = data
      .replace(/%OPTION_A%/g, escapeHtml(optionA))
      .replace(/%OPTION_B%/g, escapeHtml(optionB));

    res.send(out);
  });
});

server.listen(port, function () {
  var port = server.address().port;
  console.log('App running on port ' + port);
});

// add node-fetch or use built-in fetch if available (Node 18+)
const fetch = global.fetch || require('node-fetch');

let remoteOptionA = process.env.OPTION_A || 'Cats';
let remoteOptionB = process.env.OPTION_B || 'Dogs';

async function loadOptionsFromVote() {
  try {
    const res = await fetch('http://vote/options', { timeout: 2000 });
    if (!res.ok) throw new Error('bad');
    const json = await res.json();
    remoteOptionA = json.option_a || remoteOptionA;
    remoteOptionB = json.option_b || remoteOptionB;
  } catch (e) {
    // keep existing values; retry later
  }
}
// call at startup and every 5s
loadOptionsFromVote();
setInterval(loadOptionsFromVote, 5000);
