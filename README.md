# es52es6

Node.js prototype for refactoring legacy JavaScript code (ECMAScript 5 or earlier versions) to ECMAScript 6 (ES6) modules. The refactoring improves encapsulation and coupling between the refactored modules, through the introduction of ES6 named exports and ES6 static named imports.

<br/>

## Introduction

JavaScript, prior to ECMAScript 6, does not provide features for modularity and encapsulation. Towards this problem, module formats (CommonJS, AMD) and their specifications (e.g. Node.js, RequireJS) introduce the notion of the *module object*, the object specifying the module's interface that is visible to client modules. However, the module object affects coupling between modules, since the client modules gain access to unused module features.

ECMAScript 6, through the ES Modules (ESM) specification, provides features for improving coupling, in terms of *ES6 named exports* and *ES6 static named imports*. ES6 named exports reduce the public API of the module that is visible to its clients, thus improving encapsulation. ES6 static named imports enable selecting the module features that are actually used in the module's scope, thus restricting coupling.

<br/>

## Target formats/specifications

Non-modular ES5, CommonJS (Node.js), AMD (RequireJS).

<br/>

## How to use

The prototype runs in node 10.x (or newer versions).
<br/>

### Flags 


| Flag | Description |
| ----------- | ----------- |
| -h | Outputs the prototype's available flags and their descriptions in the console. |
| -c | (**Mandatory**) Processing modes. Available are: (1) `preprocessing`, for converting non-strict to strict code (*useful for uncovering problems due to the transition between non-strict mode (default in ES5) in strict mode (default in ES6) before refactoring*), (2) `analysis`, for analyzing the project to assess module coupling metrics, (3) `refactoring`, for analyzing and refactoring the project to ES6 modules. |
| -s | (**Mandatory**) The analyzed project's module format. Available are: (1) `plainJS`, for non-modular ES5 projects, (2) `CommonJS`, for CommonJS projects (implemented in Node.js), (3) `AMD`, for AMD projects (implemented in RequireJS). |
| --src | (**Mandatory**) The analyzed project's relative path.|
| -e | (**Mandatory**) The analyzed project's entry file.|
| -x | (**Optional**) The analyzed project's files that are excluded from analysis. Useful for excluding project configuration and library files (files in `node_modules`) which slow down analysis.|
| -t | (**Optional**) The analyzed project's test files.|
| --library | (**Optional**) Process the analyzed project as a library (the public API of its modules is not restricted, to provide access to the project's clients).

<br/>

*Non-specification of the mandatory flags terminates analysis with a log message, 
since the refactoring may introduce software defects or lead to unexpected behaviour.*

<br/>

### Execution

Open a terminal in the directory `./es52es6` and execute the following commands:

1. `npm install` 
2. `node [--max-old-space-size=<space_size_in_bytes>] src/tool/main.js -c preprocessing | analysis | refactoring -s plainJS | CommonJS | AMD --src <relative_path_to_project> -e <relative_path_to_entry_file> [-x = <path_to_excluded_files>] [-t <path_to_test_files>]`

<br/>

### Examples of use

1. Preprocess a CommonJS project: <br/>
`node --max-old-space-size=8192 src/tool/main.js -c preprocessing -s CommonJS --src ../goojs -e ../goojs/index.js -x examples,lib,node_modules,out,spec,Gruntfile.js,\\visual-test -t \\test`

2. Analyze a CommonJS project: <br/>
`node --max-old-space-size=8192 src/tool/main.js -c analysis -s CommonJS --src ../goojs -e ../goojs/index.js -x examples,lib,node_modules,out,spec,Gruntfile.js,\\visual-test -t \\test`

3. Refactor a CommonJS project: <br/>
`node --max-old-space-size=8192 src/tool/main.js -c refactoring -s CommonJS --src ../goojs -e ../goojs/index.js -x examples,lib,node_modules,out,spec,Gruntfile.js,\\visual-test -t \\test`

4. Preprocess an AMD project: <br/>
`node --max-old-space-size=4096 src/tool/main.js -c preprocessing -s AMD --src ../GluttonousSnake -i -e ../GluttonousSnake/js/main.js -x require.js`

5. Analyze an AMD project: <br/>
`node --max-old-space-size=4096 src/tool/main.js -c analysis -s AMD --src ../GluttonousSnake -i -e ../GluttonousSnake/js/main.js -x require.js`

6. Refactor an AMD project: <br/>
`node --max-old-space-size=4096 src/tool/main.js -c refactoring -s AMD --src ../GluttonousSnake -i -e ../GluttonousSnake/js/main.js -x require.js`

7. Preprocess a non-modular ES5 project: <br/>
`node --max-old-space-size=4096 src/tool/main.js -c preprocessing -s plainJS --src ../uki -i -e ../uki/index.js -x node_modules`

8. Analyze a non-modular ES5 project: <br/>
`node --max-old-space-size=4096 src/tool/main.js -c analysis -s plainJS --src ../uki -i -e ../uki/index.js -x node_modules`

9. Refactor a non-modular ES5 project: <br/>
`node --max-old-space-size=4096 src/tool/main.js -c refactoring -s plainJS --src ../uki -i -e ../uki/index.js -x node_modules`

<br/>

### Evaluation

This prototype has been tested on the following projects:

| Project | Module Format | Version | Refactored Fork (link)
| ----------- | ----------- | ----------- | ----------- |
| UltraTetris | Non-modular ES5 | master@5ad237e | https://github.com/katerinapal/UltraTetris |
| Hangman | Non-modular ES5 | master@b950842 | https://github.com/katerinapal/Hangman |
| TicTacToe | Non-modular ES5 | master@346ebe8 | https://github.com/katerinapal/TicTacToe |
| uki | Non-modular ES5 | master@6cd2e47 | https://github.com/katerinapal/uki|
| GluttonousSnake | AMD | master@c6b49cb | https://github.com/katerinapal/GluttonousSnake |
| astix | AMD | master@f0ecc39 | https://github.com/katerinapal/astix |
| game-of-life | AMD | master@1d83874 | https://github.com/katerinapal/game-of-life |
| tetrisJS | AMD | master@27712a0 | https://github.com/katerinapal/tetrisJS |
| dynablaster-js-port | AMD | master@5b5052e | https://github.com/katerinapal/dynablaster-js-port |
| backbone-tableview | CommonJS | master@0c26357 | https://github.com/katerinapal/backbone-tableview |
| easystarjs | CommonJS | v0.4.3 | https://github.com/katerinapal/easystarjs |
| geojsonhint | CommonJS | v.2.0.0 | https://github.com/katerinapal/geojsonhint |
| express-session | CommonJS | v1.15.6 | https://github.com/katerinapal/session |
| underscore.string | CommonJS | 3.3.4 | https://github.com/katerinapal/underscore.string |
| messy | CommonJS | 6.11.0 | https://github.com/katerinapal/messy |
| virtual-dom | CommonJS | v2.1.1 | https://github.com/katerinapal/virtual-dom |
| recipe-parser | CommonJS | master@626f124 | https://github.com/katerinapal/recipe-parser |
| planck.js | CommonJS | v0.2.7 | https://github.com/katerinapal/planck.js |
| goojs | CommonJS | v0.16.8 | https://github.com/katerinapal/goojs |
