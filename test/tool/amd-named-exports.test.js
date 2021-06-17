const assertions = require('../util/assertions')
const projectUtils = require('../util/project-utils')
const findFile = projectUtils.findFile;
const utils = require('../../src/analysis/ast/util/util.js');
const ModuleFramework = require('../../src/analysis/ast/util/enums.js').ModuleFramework;
const fileUtils = require('../../src/io/fileUtilities.js');
var path = fileUtils.path;
var gluttonousSnakeProject;

const fixturesDirectory = path('test/fixtures/io/');

beforeAll(() => {
    gluttonousSnakeProject = utils.analyzeProject(path(fixturesDirectory + 'GluttonousSnake'), [], true, [], './js/main.js', ModuleFramework.AMD);    
});

test('given an AMD module, when define returns object literal, then its properties are counted as named exports', () => {

    var inputFiles = gluttonousSnakeProject;

    // changed exported object to have 3 properties
    var canvasJs = findFile(inputFiles, 'canvas.js');
    expect(canvasJs).toBeDefined();
    assertions.assertModuleExports(canvasJs, 1, 1);

    var dataJs = findFile(inputFiles, 'data.js');
    expect(dataJs).toBeDefined();
    assertions.assertModuleExports(dataJs, 1, 5);

    var gameJS = findFile(inputFiles, 'game.js');
    expect(gameJS).toBeDefined();
    assertions.assertModuleExports(gameJS, 1, 1);
});

test('given an AMD module, when require/define returns nothing, then no named exports are identified', () => {

    var inputFiles = gluttonousSnakeProject;

    var mainJS = findFile(inputFiles, 'main.js');
    expect(mainJS).toBeDefined();

    //(1) NOTICE: variables/functions declared outside define()/require()
    //are also considered as exported declarations (they are globals [bound to the global namespace])
    //(2) bug in the implementation (modified): in AMD modules, exported declarations (except globals) have 1-1 mapping
    //with either (a) the object literal provided in define(), (b) the value returned from the callback provided in define
    //if values in (a), (b) are objects, the number of exported declarations is the number of their properties
    assertions.assertModuleExports(mainJS, 1, 1);
})

