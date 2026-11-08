import {describe,it,expect} from 'vitest';
import {makeLayout,toAscii,validateLayout} from '../src/layouts.js';
describe('layouts',()=>{
 it('validates all seven canonical views',()=>{for(const name of ['map','arrow','arrived','idle','ack','released','ask'] as const)expect(validateLayout(makeLayout(name))).toEqual([]);});
 it('cleans unsupported characters and enforces screen bounds',()=>{expect(toAscii('north ° · © “OK” ☃')).toBe('north  deg - (c) "OK" ');expect(validateLayout([{kind:'text',id:1,name:'capture',x:0,y:0,w:576,h:288,z:1,content:' ',capture:true},{kind:'text',id:8,name:'status',x:0,y:288,w:576,h:28,z:2,content:'ok'}]).some(e=>e.includes('outside'))).toBe(true);});
 it('keeps every layout printable and within content bounds',()=>{for(const name of ['map','arrow','arrived','idle','ack','released','ask'] as const){const cs=makeLayout(name,{brief:'A very long briefing '.repeat(16)});expect(validateLayout(cs)).toEqual([]);for(const c of cs)if(c.kind==='text')expect(c.content!.length).toBeLessThan(1001);}});
});
