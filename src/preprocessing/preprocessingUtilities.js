/**
 * Preprocessing utilities. Utilities relevant to preprocessing code
 * before analyzing it.
*/

var fs = require('fs');

var jscodeshift = require('../../node_modules/jscodeshift');

function convertNonStrictCodeInStrictCode(inputFiles) {

    let convertedFiles = 0;

    inputFiles.buckets.forEach(fileList => {

        fileList.forEach(fileObj => {

            // console.log(fileObj[1].moduleType)
            let astRootCollection = fileObj[1].astRootCollection;

            //search for 'use strict' directives on the module scope
            let useStrictModuleDirectives = astRootCollection.find(jscodeshift.ExpressionStatement).filter(stmt => {

                if(stmt.value.expression.type !== 'Literal') {

                    return false;
                }

                let stmtLiteral = stmt.value.expression;
                if(stmtLiteral.value !== 'use strict') {

                    return false;
                }

                let stmtClosestScopes = jscodeshift(stmt).closestScope();
                if(stmtClosestScopes.length === 0) {

                    return false;
                }

                let surrScopes = stmtClosestScopes.filter(surrScope => {

                    return surrScope.value.type === 'Program';
                });

                if(surrScopes.length === 0) {

                    return false;
                }

                return true;
            });

            //module already on strict mode
            if(useStrictModuleDirectives.length > 0) {

                return;
            }

            //module on non-strict mode
            //add 'use strict' directive in its module scope
            let useStrictLiteral = jscodeshift.literal('use strict');
            let useStrictDirective = jscodeshift.expressionStatement(useStrictLiteral);
            astRootCollection.find(jscodeshift.Program).get('body',0).insertBefore(useStrictDirective);
        
            //update module with strict code
            console.log('Writing strict code to ' + fileObj[0] + '...\n');
            fs.writeFileSync(fileObj[0], astRootCollection.toSource(), 'utf-8');

            convertedFiles++;
        });

    });

    console.log('Converted files: ' + convertedFiles);
    console.log('Converted non-strict to strict code. Exiting.');
}

exports.convertNonStrictCodeInStrictCode = convertNonStrictCodeInStrictCode;