define("data",[],function(){

	//the point model
	var RectPoint = function(x,y,w,h,d){
		this.x = x;
		this.y = y;
		this.w = w;
		this.h = h;
		this.d = d;
	}

	//random number at the range of n/4~n/2 
	var randomN = function(n){
		if(n<=0){
			return 0;
		}
		return Math.ceil(Math.random()*n);
	}

	//a direction randomly
	var randomD = function(){
		//0-left 1-down 2-right 3-top
		var data = Math.floor(Math.random()*4);
		var result = {x:1,y:0};
		if(data == 1){
			result.x = 0;
			result.y = -1;
		}
		else if(data == 2){
			result.x = 1;
			result.y = 0;
		}
		else if(data == 3){
			result.x = 0;
			result.y = 1;
		}
		else{
			result.x = -1;
			result.y = 0;
		}
		return result;
	}

	//next direction clockwise
	var nextD = function(d){
		//0-left 1-down 2-right 3-top
		var temp = d.y;
		d.y = -d.x;
		d.x = temp;
		return d;
	}

	//check if a point is in the snake track
	var isIn = function(snake,x,y){
		for(i in snake){
			if(snake[i].x == x && snake[i].y == y){
				return true;
			}
		}
		return false;
	}

	//get the initial snake points 
	var genSnake = function(w,h,s,r){
		var snake = [];
		var x=0,y=0,d=0;
		if(s > 0){
			for(var i=0;i<s;i++){
				if(snake.length == 0){
					x = Math.floor(w/2/r)*r;
					y = Math.floor(h/2/r)*r;
					d = randomD();
					snake[snake.length] = new RectPoint(x,y,r,r,d);
				}
				else{
					d = snake[snake.length-1].d;
					x = snake[snake.length-1].x + d.x*r;
					y = snake[snake.length-1].y + d.y*r;
					d = randomD();
					while(isIn(snake,x+d.x*r,y+d.y*r)){
						d = nextD(d);
					}
					snake[snake.length] = new RectPoint(x,y,r,r,d);
				}
			}				
		}
		return snake;
	}

	//get an available point by recursive function
	var genAvailPoint = function(x_index,y_index,map){
		if(x_index < 0 || x_index >= map[0].length){
			return null;
		}
		if(y_index < 0 || y_index >= map.length){
			return null;
		}
		if(map[y_index][x_index] == 0){
			return {x_index:x_index,y_index: y_index};
		}
		else{
			//fore directions
			var top = genAvailPoint(x_index,y_index-1,map);
			if(top){
				return top;
			}
			var right = genAvailPoint(x_index+1,y_index,map);
			if(right){
				return right;
			}
			var down = genAvailPoint(x_index,y_index+1,map);
			if(down){
				return down;
			}
			var left = genAvailPoint(x_index-1,y_index,map);
			if(left){
				return left;
			}
			return null;
		}

	}

	//a map(0,1) mapped by the snake data 
	var getDataMap = function(w,h,r,snake){
		//col row size
		var hsize = Math.floor(h/r);
		var wsize = Math.floor(w/r);
		var map = [];
		for(var i=0;i<hsize;i++){
			map[i] = [];
			for(var j=0;j<wsize;j++){
				map[i][j] = 0;
			}
		}
		for(index in snake){
			i = snake[index].y/r;
			j = snake[index].x/r;
			map[i][j] = 1;
		}
		return map;
	}

	//get a point randomly
	var genTarget = function(w,h,r,snake){
		//the snake data maped to a map(0,1)
		var map = getDataMap(w,h,r,snake);
		//get a point croods randomly
		var x_index = Math.floor(randomN(w-r)/r);
		var y_index = Math.floor(randomN(h-r)/r);
		//check the point is available,if no search from this point by fore directions
		var result = genAvailPoint(x_index,y_index,map);
		if(result != null){
			return new RectPoint(result.x_index*r,result.y_index*r,r,r,null);
		}
		else{
			return null;
		}
	}

	//check is crashed
	var isCrash = function(w,h,snake){
		var x = snake[snake.length-1].x;
		var y = snake[snake.length-1].y;
		var sw = snake[snake.length-1].w;
		var sh = snake[snake.length-1].h;
		var d = snake[snake.length-1].d;
		//wall
		if( (x+sw*d.x+sw > w) || (y+sh*d.y+sh > h 
			|| (x+sw*d.x < 0) || (y+sh*d.y < 0)) ){
			return true;
		}
		else{
			//self
			x = x+sw*d.x;
			y = y+sh*d.y;
			if(isIn(snake,x,y)){
				return true;
			}
			else{
				return false;
			}
		}
	}

	//check can eat
	var isEat = function(snake,target){
		var x = snake[snake.length-1].x;
		var y = snake[snake.length-1].y;
		var sw = snake[snake.length-1].w;
		var sh = snake[snake.length-1].h;
		var d = snake[snake.length-1].d;

		if((x+sw*d.x == target.x) && (y+sh*d.y == target.y)){
			return true;
		}
		else{
			return false;
		}
	}

	//snake run change data
	var changeSnake = function(snake){
		for(var i=0;i<snake.length;i++){
			if(i == snake.length-1){
				snake[i].x = snake[i].x+snake[i].d.x*snake[i].w;
				snake[i].y = snake[i].y+snake[i].d.y*snake[i].h;
			}
			else{
				snake[i].x = snake[i+1].x;
				snake[i].y = snake[i+1].y;
				snake[i].d.x = snake[i+1].d.x;
				snake[i].d.y = snake[i+1].d.y;
			}
		}
		return snake;
	}

	return {
		genSnake : genSnake,
		genTarget : genTarget,
		isCrash : isCrash,
		isEat : isEat,
		changeSnake : changeSnake
	};
});