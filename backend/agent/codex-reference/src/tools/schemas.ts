import Ajv from 'ajv';
const reason = { type: 'string', minLength: 3, maxLength: 140 };
const id = { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER };
const text = { type: 'string' };
const priority = { enum: ['critical','high','normal'] };
function schema(properties: Record<string, unknown>, required: string[] = []) { return { type: 'object', properties: { reason, ...properties }, required: ['reason', ...required], additionalProperties: false }; }
export const schemas: Record<string, any> = {
  get_board: schema({}), get_survivor: schema({ survivor_id: id }, ['survivor_id']),
  list_rescuers: schema({ near_survivor_id: id, only_available: { type: 'boolean' } }),
  list_cells: schema({ statuses: { type:'array', items: { enum:['unsearched','searching','partially_searched','searched'] }, uniqueItems:true }, near_robot_id: text, include_targeted:{ type:'boolean' }, limit:{type:'integer',minimum:1,maximum:30} }),
  get_robot: schema({robot_id: text}, ['robot_id']),
  propose_assignment: schema({ survivor_id:id, rescuer_identity:{ type:'string', description:'Use the callsign from the packet, such as Rescuer A. The runner resolves the private identity locally.' } }, ['survivor_id','rescuer_identity']),
  delegate: schema({to_agent:{const:'comms_agent'},kind:{const:'brief_rescuer'},priority,assignment_id:id,survivor_id:id},['to_agent','kind','priority','assignment_id','survivor_id']),
  set_flag_status: schema({flag_id:id,status:{enum:['acted','dismissed']}}, ['flag_id','status']),
  create_mission: schema({robot_id:text,kind:{enum:['search_cells','inspect','return_home','hold']},target_cell_ids:{type:'array',items:id,minItems:1,maxItems:3,uniqueItems:true},target_lat:{type:'number',minimum:-90,maximum:90},target_lon:{type:'number',minimum:-180,maximum:180}},['robot_id','kind']),
  cancel_own_mission: schema({mission_id:id}, ['mission_id']),
  send_briefing: schema({audience:text,text:{type:'string',minLength:3,maxLength:120},priority:{enum:['info','warning','critical']},survivor_id:id}, ['audience','text','priority']),
  submit_review: schema({reason:{type:'string',minLength:3,maxLength:200},verdict:{enum:['agree','disagree']},flag_kind:{enum:['proposal_disagree','load_imbalance']},suggested_action:{type:'string',maxLength:140}},['verdict']),
  sitrep: schema({audience:{enum:['commander','coordinators']}},['audience']),
};
const ajv = new Ajv.Ajv({ allErrors:true, strict:true });
export const validators = Object.fromEntries(Object.entries(schemas).map(([name, s]) => [name, ajv.compile(s)]));
export function toolDefinitions(names: string[]) { return names.map(name => ({type:'function' as const,function:{name,description:`${name}: act on the current active run only. Every call requires a short factual reason.`,parameters:schemas[name]}})); }
