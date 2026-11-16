"use client";
import {VStack,HStack} from '@astryxdesign/core/Stack';
import {Heading,Text} from '@astryxdesign/core/Text';
import {Link} from '@astryxdesign/core/Link';
import type {Research} from './ProductOnboarding';

// Research findings are visible alongside the workflow, never selectable facts.
export function ResearchFindings({research}:{research:Research}){
 const rows=[...(research.findings??[]),...research.conflicts.map(text=>({kind:'source_conflict',text,evidence:[]})),...research.unknowns.map(text=>({kind:'open_question',text,evidence:[]}))];
 const unique=rows.filter((row,index)=>rows.findIndex(other=>other.text.trim()===row.text.trim())===index);
 if(!unique.length)return null;
 return <VStack gap={4}>
  <Heading level={2}>资料冲突与待核实</Heading>
  <Text type="supporting">以下是调查发现，不能作为产品事实引用。请核实后补充品牌资料，再整理事实。</Text>
  {unique.map((row,index)=><VStack key={index} gap={2}>
   <Text type="label">{row.kind==='source_conflict'?'资料冲突':row.kind==='source_note'?'来源备注':'待核实'}</Text>
   <Text>{row.text}</Text>
   <HStack gap={3} wrap="wrap">{row.evidence.map((evidence,index)=>{
    const source=research.sources.find(source=>source.id===evidence.source_id);
    return source?.url?<Link key={index} href={source.url} target="_blank" rel="noreferrer">{source.title}</Link>:null;
   })}</HStack>
  </VStack>)}
 </VStack>;
}
