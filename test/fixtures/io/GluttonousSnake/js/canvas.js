define("canvas",[],function(){

	var paint =function(game){
		//clear the canvas
		game.context.clearRect(0,0,game.width,game.height);
		// game.context.fillStyle = game.bgColor;
		// game.context.fillRect(0,0,game.width,game.height);
		//paint the snake points
		game.context.fillStyle = game.skColor;
		for(var index=0;index<game.snake.length;index++){
			if(index == game.snake.length-1){
				game.context.fillStyle = game.tgColor;
			}
			game.context.fillRect(game.snake[index].x,game.snake[index].y,game.snake[index].w,game.snake[index].h);
		}
		//paint the target point
		game.context.fillStyle = game.tgColor;
		game.context.fillRect(game.target.x,game.target.y,game.target.w,game.target.h);
	}

	return {
		paint : paint
	};
});