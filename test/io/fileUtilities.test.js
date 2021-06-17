var fileUtilities = require('../../src/io/fileUtilities.js');
var path = fileUtilities.path;
var os = require('os');

const fixturesDirectory = path('test/fixtures/io/');

test('if path separators are correctly transformed', () => {

    if (os.platform() === 'win32'){
        expect(path('../../test/fixtures/axios'))
        .toBe('..\\..\\test\\fixtures\\axios');
  
        expect(path('..\\..\\test\\fixtures\\axios'))
        .toBe('..\\..\\test\\fixtures\\axios');
    }

});

test('if recursively reads .js files', () => {

    var axiosLibDirectory = path(fixturesDirectory + "axios/lib");
    var files = fileUtilities.retrieveSourceFilesInDirectory(axiosLibDirectory, [], []);
    expect(files).toHaveLength(26);

});

test('if it ignores non .js files', () => {

    var gluttonousSnakeDirectory = path(fixturesDirectory + "GluttonousSnake/");
    var files = fileUtilities.retrieveSourceFilesInDirectory(gluttonousSnakeDirectory, [], []);
    expect(files).toHaveLength(5);

});