const debugUtils = require('../../src/io/debug-utils');
var logError = debugUtils.logError;

test('logError', () => {

    var arr = [1, 2, 3, 4];

    var sum = 0;

    try {
        sum = arr.map(logError(x => {
            if (x == 2){
                throw 5;
            }
            return 2 * x;
        }, 'msg'))
        .reduce( (sum, x) => sum + x );
    } catch (e){
        expect(e).toBe(5);    
    }


});
