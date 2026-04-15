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

// Keep a short in-memory history of recent vote events and last seen totals
var voteHistory = [];
var lastTotals = {a: 0, b: 0};
var lastEmittedId = 0; // last emitted event id from vote_events

// When a client connects, send recent history
io.on('connection', function (socket) {
  if (voteHistory.length) {
    socket.emit('history', JSON.stringify(voteHistory));
  }
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
    // load persistent history from vote_events and then start polling
    loadHistoryFromDb(client, function() {
      getVotes(client);
    });
  }
);

function loadHistoryFromDb(client, cb) {
  // replay events in chronological order to compute running percentages
  client.query('SELECT id, voter_id, vote, ts FROM vote_events ORDER BY id ASC', [], function(err, result) {
    if (err) {
      console.error('Error loading history: ' + err);
      return cb && cb();
    }

    var voterMap = {};
    var aCount = 0, bCount = 0;
    var events = [];

    result.rows.forEach(function(row) {
      var vid = row.voter_id || ('v' + row.id);
      var v = row.vote;
      var prev = voterMap[vid];
      if (prev === v) {
        // no change
      } else {
        if (prev === 'a') aCount--; else if (prev === 'b') bCount--;
        if (v === 'a') aCount++; else if (v === 'b') bCount++;
        voterMap[vid] = v;
      }

      var total = aCount + bCount;
      var aPct = 50, bPct = 50;
      if (total > 0) {
        aPct = Math.round(aCount / total * 100);
        bPct = 100 - aPct;
      }

      events.push({id: row.id, ts: (row.ts && row.ts.toISOString()) || new Date().toISOString(), aPercent: aPct, bPercent: bPct});
    });

    // keep only recent 200
    if (events.length > 200) events = events.slice(events.length - 200);
    voteHistory = events.reverse(); // most recent first
    if (result.rows.length) {
      lastEmittedId = result.rows[result.rows.length - 1].id || lastEmittedId;
    }

    cb && cb();
  });
}

function getVotes(client) {
  client.query('SELECT vote, COUNT(id) AS count FROM votes GROUP BY vote', [], function(err, result) {
    if (err) {
      console.error("Error performing query: " + err);
    } else {
      var votes = collectVotesFromResult(result);
      votes.hostname = os.hostname();
      io.sockets.emit("scores", JSON.stringify(votes));

      // detect new votes since lastTotals and emit per-vote events
      var deltaA = (votes.a || 0) - (lastTotals.a || 0);
      var deltaB = (votes.b || 0) - (lastTotals.b || 0);
      var total = (votes.a || 0) + (votes.b || 0);

      if (deltaA > 0 || deltaB > 0) {
        // fetch any new events from vote_events since lastEmittedId and emit them in order
        client.query('SELECT id, voter_id, vote, ts FROM vote_events WHERE id > $1 ORDER BY id ASC', [lastEmittedId], function(err2, res2) {
          if (err2) {
            console.error('Error fetching new events: ' + err2);
          } else {
            var voterMap = {};
            // rebuild voterMap from current vote table to have correct starting counts
            // this is a light-weight approach: read current votes to seed voterMap
            client.query('SELECT id, vote FROM votes', [], function(err3, res3) {
              if (!err3) {
                var aCount = 0, bCount = 0;
                res3.rows.forEach(function(r){
                  voterMap[r.id] = r.vote;
                  if (r.vote === 'a') aCount++; else if (r.vote === 'b') bCount++;
                });

                // now apply new events in order and emit running percentages
                res2.rows.forEach(function(row) {
                  var vid = row.voter_id || ('v' + row.id);
                  var v = row.vote;
                  var prev = voterMap[vid];
                  if (prev === v) {
                    // nothing
                  } else {
                    if (prev === 'a') aCount--; else if (prev === 'b') bCount--;
                    if (v === 'a') aCount++; else if (v === 'b') bCount++;
                    voterMap[vid] = v;
                  }

                  var totalNow = aCount + bCount;
                  var aPct = 50, bPct = 50;
                  if (totalNow > 0) {
                    aPct = Math.round(aCount / totalNow * 100);
                    bPct = 100 - aPct;
                  }

                  var ev = {id: row.id, ts: (row.ts && row.ts.toISOString()) || new Date().toISOString(), aPercent: aPct, bPercent: bPct};
                  voteHistory.unshift(ev);
                  io.sockets.emit('vote', JSON.stringify(ev));
                  lastEmittedId = row.id || lastEmittedId;
                });

                if (voteHistory.length > 200) voteHistory.length = 200;
              }
            });
          }
        });
      }

      lastTotals = {a: votes.a || 0, b: votes.b || 0};
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
