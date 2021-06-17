/**
 * 
 */

function CommonCoupledModuleSet(sharedGlobal, declarationModule, commonCoupledModules) {
	
	this.sharedGlobal = sharedGlobal;
	this.declarationModule = declarationModule;
	this.commonCoupledModules = commonCoupledModules;
}

exports.CommonCoupledModuleSet = CommonCoupledModuleSet;