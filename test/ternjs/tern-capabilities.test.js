const assertions = require('../util/assertions')
const projectUtils = require('../util/project-utils')
const findFile = projectUtils.findFile;
const utils = require('../../src/analysis/ast/util/util.js');
const ModuleFramework = require('../../src/analysis/ast/util/enums.js').ModuleFramework;
const fileUtils = require('../../src/io/fileUtilities.js');
var path = fileUtils.path;
var goojsProject;

var tern = require('../../node_modules/tern');
var codeUtils = require('../../src/analysis/ast/util/codeHierarchyUtilities')
var inputFiles;

const fixturesDirectory = path('test/fixtures/');

var ternServer = new tern.Server({});

beforeAll(() => {
    var fileList = fileUtils.retrieveSourceFilesInDirectory(
        path(fixturesDirectory + 'goojs'), [], [])
    inputFiles = utils.retrieveModuleDefinedInFiles(fileList, [], [], './index.js');
});

test('basic usage of ternjs', () => {

    var inputFile = findFile(inputFiles, 'ArrayUtils.js');
    ternServer.addFile(inputFile.fileName, 
        inputFile.astRootCollection.toSource());
    


});