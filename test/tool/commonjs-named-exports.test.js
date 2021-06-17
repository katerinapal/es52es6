const assertions = require('../util/assertions')
const projectUtils = require('../util/project-utils')
const findFile = projectUtils.findFile;
const utils = require('../../src/analysis/ast/util/util.js');
const ModuleFramework = require('../../src/analysis/ast/util/enums.js').ModuleFramework;
const fileUtils = require('../../src/io/fileUtilities.js');
var path = fileUtils.path;
var goojsProject;

const fixturesDirectory = path('test/fixtures/');

beforeAll(() => {
    goojsProject = utils.analyzeProject(path(fixturesDirectory + 'goojs'), [], true, [], './index.js', ModuleFramework.CommonJS);    
});

test('given a CJS module, when define returns empty function, then its properties are counted as named exports', () => {

    var inputFiles = goojsProject;

    // changed exported object to have 3 properties
    var arrayUtilsJS = findFile(inputFiles, 'ArrayUtils.js');
    expect(arrayUtilsJS).toBeDefined();
    assertions.assertModuleExports(arrayUtilsJS, 1, 5);

});

test('given a CJS module, when define a multi-property object literal, then its properties are counted as named exports', () => {

    var inputFiles = goojsProject;

    // changed exported object to have 3 properties
    var arrayUtilsJS = findFile(inputFiles, 'Easing.js');
    expect(arrayUtilsJS).toBeDefined();
    assertions.assertModuleExports(arrayUtilsJS, 1, 11);

});

/*
test('given an AMD module, when require/define returns nothing, then no named exports are identified', () => {

    var inputFiles = goojsProject;

    var mainJS = findFile(inputFiles, 'main.js');
    expect(mainJS).toBeDefined();
    assertions.assertModuleExports(mainJS, 0, 0);
})
*/
