var os = require('os');
var express = require('express'),
    async = require('async'),
    { Pool } = require('pg'),
    cookieParser = require('cookie-parser'),
    app = express(),
    server = require('http').Server(app),
    io = require('socket.io')(server);

// Prefer explicit app port; fall back to generic PORT and then to 4000
var port = process.env.APP_PORT || process.env.PORT || 4000;

io.on('connection', function (socket) {

  socket.emit('message', { text: 'Welcome!', hostname: os.hostname() });

  socket.on('subscribe', function (data) {
    socket.join(data.channel);
  });
});

// Build connection string from DATABASE_URL or from individual DB_* vars
var pool = new Pool({
  connectionString: (function(){
    if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
    var user = process.env.POSTGRES_USER || 'postgres';
    var pass = process.env.POSTGRES_PASSWORD || 'postgres';
    var host = process.env.DB_HOST || 'db';
    var dbport = process.env.DB_PORT || '5432';
    return 'postgres://' + user + ':' + pass + '@' + host + ':' + dbport + '/postgres';
  })()
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
      votes.hostname = os.hostname();
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
app.use(express.static(__dirname + '/views'));

app.get('/', function (req, res) {
  res.sendFile(path.resolve(__dirname + '/views/index.html'));
});

server.listen(port, function () {
  var port = server.address().port;
  console.log('App running on port ' + port);
});
