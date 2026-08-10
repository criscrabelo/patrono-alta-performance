const fs = require('node:fs');
const path = require('node:path');
const PptxGenJS = require('pptxgenjs');
const PDFDocument = require('pdfkit');

const EXPORT_DIR = path.join(__dirname, 'data', 'exports');
function safe(value) { return String(value || '').replace(/[^a-z0-9-_]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'apresentacao'; }
async function generatePresentation(input) {
  fs.mkdirSync(EXPORT_DIR, { recursive: true });
  const id = `${Date.now()}-${safe(input.audience)}-${safe(input.department)}`;
  const pptxPath = path.join(EXPORT_DIR, `${id}.pptx`);
  const pdfPath = path.join(EXPORT_DIR, `${id}.pdf`);
  const title = input.title || 'COEVO Alta Performance';
  const topics = Array.isArray(input.topics) && input.topics.length ? input.topics : ['Resumo executivo','Indicadores','Riscos','Próximos passos'];
  const pptx = new PptxGenJS(); pptx.layout='LAYOUT_WIDE'; pptx.author='COEVO Alta Performance'; pptx.subject='Apresentação corporativa auditada';
  let slide = pptx.addSlide(); slide.background={color:'081218'}; slide.addText(title,{x:.7,y:1.4,w:12,h:.6,fontFace:'Arial',fontSize:28,bold:true,color:'FFFFFF'}); slide.addText(`${input.audience || 'Comitê'} · ${input.department || 'Visão COEVO'} · ${input.competence || ''}`,{x:.7,y:2.2,w:12,h:.35,fontSize:13,color:'BCEEF2'});
  for (const topic of topics) { slide=pptx.addSlide(); slide.addText(String(topic),{x:.6,y:.5,w:12,h:.4,fontSize:22,bold:true,color:'137F91'}); slide.addText(input.detail || 'Conteúdo sujeito a homologação e filtrado por perfil, departamento, finalidade e classificação.',{x:.7,y:1.3,w:11.8,h:1.2,fontSize:16,color:'081218',breakLine:false}); slide.addText('Fonte e memória de cálculo devem acompanhar os indicadores.',{x:.7,y:6.8,w:11.8,h:.25,fontSize:9,color:'60737B'}); }
  await pptx.writeFile({ fileName: pptxPath });
  await new Promise((resolve,reject)=>{ const doc=new PDFDocument({size:'A4',margin:48}); const out=fs.createWriteStream(pdfPath); doc.pipe(out); doc.fillColor('#081218').fontSize(24).text(title); doc.moveDown(.5).fillColor('#60737B').fontSize(11).text(`${input.audience || 'Comitê'} · ${input.department || 'Visão COEVO'} · ${input.competence || ''}`); topics.forEach(topic=>{doc.moveDown(2).fillColor('#137F91').fontSize(18).text(String(topic)); doc.moveDown(.5).fillColor('#081218').fontSize(12).text(input.detail || 'Conteúdo sujeito a homologação e filtrado por escopo e classificação.');}); doc.end(); out.on('finish',resolve); out.on('error',reject); });
  return { id, pptxPath, pdfPath, topics, generatedAt:new Date().toISOString() };
}
module.exports = { generatePresentation };

