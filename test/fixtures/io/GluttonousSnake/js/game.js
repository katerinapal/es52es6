define("game",["canvas","data"],function(canvas,data){
	var Game = function(width,height,context,scoreContainer,alert){
		this.width = width;
		this.height = height;
		this.context = context;
		this.scoreContainer = scoreContainer;
		this.alert = alert;
		this.bgColor = "#BFEFFF";
		this.skColor = "#008B00";
		this.tgColor = "#CD0000";
		this.snake = [];
		this.target = {};
		this.rectR = 10;
		this.initS = 4;
		this.score = 0;
		this.runSpeed = 100;
		this.fps = 17;
		this.isRunning = 1;
		//setInterval
		this.paintTask = null;
		this.runTask = null;
	}

	Game.prototype.showOver = function(v){
		if(v == 1){
			this.alert.style.display = "block";
		}
		else{
			this.alert.style.display = "none";
		}
	}

	Game.prototype.refreshScore = function(){
		for(index in this.scoreContainer){
			this.scoreContainer[index].innerText = this.score;
		}
	}

	Game.prototype.start = function(){
		this.score = 0;
		this.refreshScore();
		this.showOver(0);
		//get a random snake points and target point
		this.snake = data.genSnake(this.width,this.height,this.initS,this.rectR);
		this.target = data.genTarget(this.width,this.height,this.rectR,this.snake);
		//fps 60 paint
		this.paintTask = setInterval(()=>{
			canvas.paint(this);
		},this.fps);
		//run
		this.run();
	}

	Game.prototype.turnLeft = function(){
		var point = this.snake[this.snake.length-1];
		var point_pre = this.snake[this.snake.length-2];
		if(point.d.x == 0){
			//when the first point direction was changed,the canvas have not rendered,and the second point direction is right,and their y-axis are same,turnLeft should not be executed
			if(point.y == point_pre.y && point_pre.d.x == 1 && point_pre.d.y == 0 ){
				return;
			}
			else{
				point.d.x = -1;
				point.d.y = 0;
			}
		}
	}

	Game.prototype.turnRight = function(){
		var point = this.snake[this.snake.length-1];
		var point_pre = this.snake[this.snake.length-2];
		if(point.d.x == 0){
			if(point.y == point_pre.y && point_pre.d.x == -1 && point_pre.d.y == 0 ){
				return;
			}
			else{
				point.d.x = 1;
				point.d.y = 0;
			}
		}
	}

	Game.prototype.turnTop = function(){
		var point = this.snake[this.snake.length-1];
		var point_pre = this.snake[this.snake.length-2];
		if(point.d.y == 0){
			if(point.x == point_pre.x && point_pre.d.x == 0 && point_pre.d.y == 1 ){
				return;
			}
			else{
				point.d.y = -1;
				point.d.x = 0;
			}
		}
	}

	Game.prototype.turnDown = function(){
		var point = this.snake[this.snake.length-1];
		var point_pre = this.snake[this.snake.length-2];
		if(point.d.y == 0){
			if(point.x == point_pre.x && point_pre.d.x == 0 && point_pre.d.y == -1 ){
				return;
			}
			else{
				point.d.x = 0;
				point.d.y = 1;
			}
		}
	}

	Game.prototype.run = function(){
		this.runTask = setInterval(()=>{
			//snake run
			if(data.isCrash(this.width,this.height,this.snake)){
				this.over();
			}
			else{
				if(data.isEat(this.snake,this.target)){
					this.score += 100;
					this.refreshScore();
					//eat
					this.target.d = {x:this.snake[this.snake.length-1].d.x,y:this.snake[this.snake.length-1].d.y};
					this.snake[this.snake.length] = this.target;
					this.target = data.genTarget(this.width,this.height,this.rectR,this.snake);
					//if target is null, the this is over, you win
					if(this.target == null){
						this.over();
					}
				}
				//run
				data.changeSnake(this.snake);
			}
		},this.runSpeed);
	}

	Game.prototype.over = function(){
		clearInterval(this.runTask);
		clearInterval(this.paintTask);
		this.showOver(1);
	}

	return Game;
});	