/**
 * 
 */

let ProgramMode = {

	preprocess: '--preprocessing',
	analysis: '--analysis',
	refactoring: '--refactoring'
};
Object.freeze(ProgramMode);

let SourceVersion = {
	ES5: 'ES5', 
	ES6: 'ES6'
};
Object.freeze(SourceVersion);


let ModuleFramework = {
	
	CommonJS: 'CommonJS', 
	AMD: 'AMD',
	plain: 'plainJS'
};
Object.freeze(ModuleFramework);

let ModuleType = {

	excludedFile: 'excluded',
	testFile: 'test',
	componentFile: 'component',
	library: 'library'
};
Object.freeze(ModuleType);


exports.SourceVersion = SourceVersion;
exports.ModuleFramework = ModuleFramework;
exports.ProgramMode = ProgramMode;
exports.ModuleType = ModuleType;