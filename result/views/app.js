var app = angular.module('catsvsdogs', []);
var socket = io.connect();

var bg1 = document.getElementById('background-stats-1');
var bg2 = document.getElementById('background-stats-2');

function getCookie(name) {
  var m = document.cookie.match(new RegExp('(^|; )' + name + '=([^;]*)'));
  return m ? decodeURIComponent(m[2]) : null;
}

function updateDocumentTitle(a, b) {
  document.title = (a || 'Cats') + ' vs ' + (b || 'Dogs') + ' -- Result';
}

app.controller('statsCtrl', function($scope){
  $scope.aPercent = 50;
  $scope.bPercent = 50;
  $scope.history = [];

  $scope.optionA = getCookie('option_a') || 'Cats';
  $scope.optionB = getCookie('option_b') || 'Dogs';
  updateDocumentTitle($scope.optionA, $scope.optionB);

  var updateScores = function(){
    socket.on('scores', function (json) {
       data = JSON.parse(json);
       var a = parseInt(data.a || 0);
       var b = parseInt(data.b || 0);

       var percentages = getPercentages(a, b);

       bg1.style.width = percentages.a + "%";
       bg2.style.width = percentages.b + "%";

       $scope.$apply(function () {
         $scope.aPercent = percentages.a;
         $scope.bPercent = percentages.b;
         $scope.total = a + b;
         $scope.hostname = data.hostname || $scope.hostname || window.location.hostname;
       });
    });

    // receive initial history
    socket.on('history', function(json){
      var items = [];
      try { items = JSON.parse(json || '[]'); } catch(e) { items = []; }
      $scope.$apply(function(){
        $scope.history = items;
      });
    });

    // receive single-vote events and prepend to history
    socket.on('vote', function(json){
      var ev = null;
      try { ev = JSON.parse(json); } catch(e) { return; }
      $scope.$apply(function(){
        $scope.history.unshift(ev);
        if ($scope.history.length > 200) $scope.history.length = 200;
      });
    });
  };

  var init = function(){
    document.body.style.opacity=1;
    updateScores();
  };
  socket.on('message', function(data){
    $scope.$apply(function(){
      $scope.hostname = data.hostname || window.location.hostname;
    });
    init();
  });
});

function getPercentages(a, b) {
  var result = {};

  if (a + b > 0) {
    result.a = Math.round(a / (a + b) * 100);
    result.b = 100 - result.a;
  } else {
    result.a = result.b = 50;
  }

  return result;
}