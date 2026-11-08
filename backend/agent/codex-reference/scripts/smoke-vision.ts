import { loadConfig } from '../src/config.js';
const cfg=loadConfig();
console.log(JSON.stringify({status:'not_implemented',reason:'The optional vision describer is not implemented. Its model smoke and person-image cloud upload also require the team decision specified in E10; no request sent.',model:cfg.modelVision}));
