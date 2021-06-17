require.config({
	paths:{
		canvas:"canvas",
		game:"game",
		data:"data"
	}
});

var id = "gs";

require(["game"],function(Game){
	//get canvas object
	var canvas = document.getElementById("gs");
	var context = context || canvas.getContext("2d");
	var width = canvas.width;
	var height = canvas.height;
	var scoreContainer = document.getElementsByClassName("score");
	var alert = document.getElementById("alert");
	//game start
	var game = game || new Game(width,height,context,scoreContainer,alert);
	game.start();
	//events
	document.onkeydown = function(e){
		if(e.keyCode == 37){
			game.turnLeft();
		}
		if(e.keyCode == 38){
			game.turnTop();
		}
		if(e.keyCode == 39){
			game.turnRight();
		}
		if(e.keyCode == 40){
			game.turnDown();
		}
	};
	document.getElementById("key_top").onclick = function(){
		game.turnTop();
	};
	document.getElementById("key_left").onclick = function(){
		game.turnLeft();
	};
	document.getElementById("key_right").onclick = function(){
		game.turnRight();
	};
	document.getElementById("key_down").onclick = function(){
		game.turnDown();
	};
	document.getElementById("restart").onclick = function(){
		game.start();
	};
});