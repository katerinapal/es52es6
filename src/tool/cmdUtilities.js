const fs = require('fs');

/**
 * Maybe we should always refer to the npm packages that are installed
 * **locally** in the tool (prevent crashes in the case that the tool is
 * run before the installation of its dependencies or crashes due to 
 * npm package updates to different versions).
*/
const commandLineArgs = require('../../node_modules/command-line-args');
const commandLineUsage = require('../../node_modules/command-line-usage');

class FileDetails {
	constructor (filename) {
	  this.filename = filename
	  this.exists = fs.existsSync(filename)
	}
  }

//ignoreTests default value set to false
//(the user should explicitly report that during analysis/refactoring the tests should be ignored)
const optionDefinitions = [
	{
	  name: 'help',
	  alias: 'h',
	  type: Boolean,
	  description: 'Display this usage guide.'
	},
	{
		name: 'command',
		alias: 'c',
		type: String,
		defaultValue: 'analysis',
		description: 'Run preprocessing (converting non-strict to strict mode before analysis/refactoring), analysis or refactoring on the given project',
		typeLabel: '<preprocessing|analysis|refactoring>'
	},
	{
		name: 'system',
		alias: 's',
		type: String,
		defaultValue: 'CommonJS',
		description: 'Module system of the input project',
		typeLabel: '<CommonJS|AMD|plainJS>'
	},
	{
	  name: 'src',
	  multiple: false,
	  type: filename => new FileDetails(filename),
	  description: 'Relative path to project',
	  defaultOption: true,
	  typeLabel: '<path>' },
	{
	  name: 'ignoreTests',
	  alias: 'i',
	  type: Boolean,
	  defaultValue: false,
	  description: 'Ignore test files during analysis',
	  typeLabel: '<boolean>' },
	{
	  name: 'entryFile',
	  alias: 'e',
	  type: filename => new FileDetails(filename),
	  description: 'Entry file of the CommonJS project',
	  typeLabel: '<path>'
	},
	{
		name: 'tests',
		alias: 't',
		type: String,
		defaultValue: '',
		description: 'Treat as tests the files selected by the regex pattern',
		typeLabel: '<regex>'
	},
	{
		name: 'excludedFiles',
		alias: 'x',
		type: String,
		defaultValue: '',
		description: 'Exclude files selected by the regex pattern',
		typeLabel: '<regex>'
	},
	{
		name: 'externalLibraries',
		alias: 'l',
		type: String,
		defaultValue: '',
		description: 'External library files (applied to AMD projects)',
		typeLabel: '<regex>'
	},
	{
		name: 'library',
		alias: 'p',
		type: Boolean,
		defaultValue: false,
		description: 'The system that is transformed is a library',
		typeLabel: '<boolean>' }
]

function parseArgs(){
	const options = commandLineArgs(optionDefinitions)

	if (options.help) {
		const usage = commandLineUsage([
			{
				header: 'A tool for analysis and refactoring to ES6 modules',
				content: 'Usage of the project is provided below'
			},
			{
				header: 'Options',
				optionList: optionDefinitions
			},
			{
				content: 'Project home: {underline https://github.com/me/example}'
			}
		])
		console.log(usage)
	} else {
		console.log(options)
	}

	return options;
}

exports.parseArgs = parseArgs;