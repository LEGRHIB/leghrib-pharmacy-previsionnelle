// ==================== GLOBAL STATE ====================
const DB = {
  rotation: [], monthly: {}, nomenclature: [], nationalDCI: [],
  products: {}, suppliers: {}, dciGroups: {},
  settings: {
    alert_rupture:5, alert_securite:15, stock_cible:90, surstock:120, prix_perime_mois:3,
    growth_global:0, growth_categories:{medicament:0,parapharm:0,dispositif:0,autre:0},
    targetMonths:{AX:3,AY:2.5,AZ:2,BX:2.5,BY:2,BZ:1.5,CX:2,CY:1.5,CZ:1},
  },
  manualDCI:{}, // V4: manual DCI corrections + category tags
  manualCategories:[], // V4.1: user-defined custom categories
  uniqueDCINames:[], // V4.1: sorted canonical DCI names for dropdown
  importStatus: {rotation:false, monthly:0, nomenclature:false, chifaDCI:false},
  loaded: false
};

// ==================== UTILITIES ====================
const fmt = (n,d=0) => n==null||isNaN(n)?'-':Number(n).toLocaleString('fr-FR',{minimumFractionDigits:d,maximumFractionDigits:d});
const fmtDA = n => n==null||isNaN(n)||n===0?'-':fmt(n)+' DA';
const pct = n => n==null||isNaN(n)?'-':(n*100).toFixed(1)+'%';
const san = s => s?String(s).trim().toUpperCase():'';
const escAttr = s => s.replace(/'/g,"\\'").replace(/"/g,'&quot;');

function excelDate(v){
  if(v instanceof Date)return v;
  if(typeof v==='number')return new Date((v-25569)*864e5);
  if(typeof v==='string')return new Date(v);
  return null;
}
function monthKey(d){if(!d)return null;const dt=d instanceof Date?d:new Date(d);return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}`;}

// Extract dosage from product name: "LOMAC 20MG B/15" -> "20MG"
function extractDosage(name){
  if(!name)return null;
  let n=name.toUpperCase();
  
  // Step 1: More aggressive normalization of European thousands separators
  // 200.000UI → 200000UI, 1.200.000UI → 1200000UI, 200.000 UI → 200000UI
  // Handle multiple dots: repeatedly remove dots that are before exactly 3 digits followed by more digits or a unit
  while(true){
    const before=n;
    // Match: digit, dot, 3 digits, where next char is either another dot+digits or whitespace+unit or unit directly
    n=n.replace(/(\d)\.(\d{3})(?=\.?\d|\s*(?:MG|G|ML|UI|MCG|µG|%))/gi,'$1$2');
    if(n===before)break; // No more replacements
  }
  
  // Step 2: Remove spaces around numbers before units for consistent matching
  n=n.replace(/(\d)\s+(MG|G|ML|UI|MCG|µG|%)/gi,'$1$2');
  
  // Match compound dosages first: 400MG/20MG, 100MG/12.5MG/ML, 1G/125MG, 1MG/5MG
  let m=n.match(/(\d+(?:[.,]\d+)?\s*(?:MG|G|ML|UI|MCG|µG)\s*\/\s*\d+(?:[.,]\d+)?\s*(?:MG|G|ML|UI|MCG|µG)(?:\s*\/\s*\d*(?:[.,]\d+)?\s*(?:MG|G|ML|UI|MCG|µG))?)/i);
  if(m)return m[1].replace(/\s+/g,'').toUpperCase();
  // Match slash dosages without units on first part: 10/160MG, 150/5MG, 300/10MG
  m=n.match(/(\d+(?:[.,]\d+)?\s*\/\s*\d+(?:[.,]\d+)?\s*(?:MG|G|ML|UI|MCG|µG))/i);
  if(m)return m[1].replace(/\s+/g,'').toUpperCase();
  // Match percentage: 0.05%, 0.1%
  m=n.match(/(\d+(?:[.,]\d+)?\s*%)/i);
  if(m)return m[1].replace(/\s+/g,'').toUpperCase();
  // Match dosage with /ML suffix: 5MG/ML, 20MG/ML
  m=n.match(/(\d+(?:[.,]\d+)?\s*(?:MG|G|UI|MCG|µG)\s*\/\s*ML)/i);
  if(m)return m[1].replace(/\s+/g,'').toUpperCase();
  // Match single dosage: 20MG, 1G, 4000UI, 200000UI (now without dots)
  m=n.match(/(\d+(?:[,]\d+)?\s*(?:MG|G|ML|UI|MCG|µG))/i);
  if(m)return m[1].replace(/\s+/g,'').replace(',','.').toUpperCase();
  return null;
}

// Normalize dosage for comparison: "20MG" -> "20MG", "1G" -> "1000MG" etc
function normalizeDosage(d){
  if(!d)return null;
  d=d.toUpperCase().replace(/\s+/g,'').replace(/,/g,'.');
  // Percentage: keep as-is
  if(d.includes('%'))return d;
  // Compound dosage with /: normalize each part
  if(d.includes('/')){
    return d.split('/').map(part=>{
      part=part.trim();
      let m=part.match(/^([\d.]+)G$/i);
      if(m)return (parseFloat(m[1])*1000)+'MG';
      m=part.match(/^([\d.]+)(MG|ML|UI|MCG|µG)$/i);
      if(m)return parseFloat(m[1])+m[2].toUpperCase();
      return part;
    }).join('/');
  }
  // Convert G to MG for comparison
  let m=d.match(/^([\d.]+)G$/i);
  if(m)return (parseFloat(m[1])*1000)+'MG';
  // Remove leading zeros and normalize number
  m=d.match(/^([\d.]+)(MG|ML|UI|MCG|µG)(.*)$/i);
  if(m)return parseFloat(m[1])+m[2].toUpperCase()+m[3];
  return d;
}

// Extract brand name from ERP product name: "LOMAC 20MG B/15 GELULE" -> "LOMAC"
function extractBrand(name){
  if(!name)return null;
  const n=san(name);
  // Step 1: Remove trailing dots/spaces
  let s=n.replace(/\.+$/,'').trim();
  // Step 2: Remove pharmaceutical form keywords and everything after them
  s=s.replace(/\s+(B|BT|FL|F|T|TB)\/\d.*$/i,'')
     .replace(/\s+(COMP|GELULE|GLES|GELS?|PDRE|AMP|INJ|SUPPO|SPRAY|SIROP|CREME|POMMADE|COLLYRE|SOL|SCH|OVULE|SACHET|CAPS|PATCH|SUSP)\b.*$/i,'')
     .trim();
  // Step 3: Remove dosage patterns (compound: 10/160MG, percentages: 0.05%, standard: 500MG, 1G)
  // First remove compound dosages like 150/5MG, 10/160MG, 400MG/5ML etc
  s=s.replace(/\s+\d+(?:[.,]\d+)?(?:\s*(?:MG|G|ML|UI|MCG|µG))?\s*\/\s*\d+(?:[.,]\d+)?\s*(?:MG|G|ML|UI|MCG|µG).*$/i,'')
     .trim();
  // Remove percentage patterns: 0.05%, 0.1%
  s=s.replace(/\s+\d+(?:[.,]\d+)?\s*%.*$/i,'').trim();
  // Remove standard dosages: 500MG, 1G, 20MG/ML etc
  s=s.replace(/\s+\d[\d\s.,]*\s*(?:MG|G|ML|UI|MCG|µG)\b.*$/i,'').trim();
  // Remove bare numbers at end that look like strengths (e.g. "AROVAN 20", "ATHYROZOL 5")
  // But only if they're clearly numeric suffixes, not part of brand like "APTAMIL 2"
  // Step 4: Remove known pharmaceutical suffixes (age/form markers)
  s=s.replace(/\s+(AD|ENF|NOUR|NRS|ADULTE|ENFANT|NOURRISSON|PEDIATRIQUE|PED)\b.*$/i,'').trim();
  // Remove ratio markers like "8:1", "8.1"
  s=s.replace(/\s+\d+[.:]\d+\w*$/i,'').trim();
  // Remove LP, XR, CR, SR (extended release markers) at end
  s=s.replace(/\s+(LP|XR|CR|SR|MR|ER|RETARD)\s*$/i,'').trim();
  // Step 5: Clean up remaining artifacts
  s=s.replace(/\s+\d+\s*$/,'').trim(); // trailing bare number
  s=s.replace(/\.+$/,'').trim();
  // Step 6: If still multi-word (>3), take first 2 meaningful words
  const parts=s.split(/\s+/);
  if(parts.length>3)return parts.slice(0,2).join(' ');
  return s||null;
}

// ==================== FILE IMPORT ====================
function parseXLSX(file){
  return new Promise((resolve,reject)=>{
    const r=new FileReader();
    r.onload=e=>{
      try{
        const wb=XLSX.read(e.target.result,{type:'array',cellDates:true});
        const sheet=wb.Sheets[wb.SheetNames[0]];
        const raw=XLSX.utils.sheet_to_json(sheet,{defval:null,header:1});
        // V3: Also extract all other sheets (for retraits etc.)
        const allSheets={};
        wb.SheetNames.forEach(sn=>{
          allSheets[sn]=XLSX.utils.sheet_to_json(wb.Sheets[sn],{defval:null,header:1});
        });
        resolve({raw,name:file.name,allSheets,sheetNames:wb.SheetNames});
      }catch(err){reject(err)}
    };
    r.onerror=reject;
    r.readAsArrayBuffer(file);
  });
}

function detectAndImport(raw, fileName, allSheets, sheetNames){
  // Find header row (first row with at least 4 non-null values that look like headers)
  let headerIdx=0;
  for(let i=0;i<Math.min(20,raw.length);i++){
    const row=raw[i];
    if(!row)continue;
    const vals=row.filter(v=>v!=null&&String(v).trim()!=='');
    if(vals.length>=4){
      const strs=vals.map(v=>String(v));
      // Check for known headers
      // V4.1: Chifa AI database detection (replaces old national DCI)
      if(strs.some(s=>s.toUpperCase().includes('DCI'))&&strs.some(s=>s.includes('signation'))&&strs.some(s=>s.toUpperCase().includes('TARIF')||s.toUpperCase().includes('CODE'))){
        headerIdx=i;
        return importChifaDCI(raw,headerIdx,fileName,allSheets,sheetNames);
      }
      if(strs.some(s=>s==='Désignation/Nom commercial'||s.includes('signation'))){
        headerIdx=i;
        break;
      }
    }
  }
  // Convert to objects using detected header
  const headers=raw[headerIdx];
  const data=[];
  for(let i=headerIdx+1;i<raw.length;i++){
    const row=raw[i];
    if(!row)continue;
    const obj={};
    headers.forEach((h,j)=>{if(h!=null)obj[String(h).trim()]=row[j]!=null?row[j]:null});
    data.push(obj);
  }

  const cols=Object.keys(data[0]||{});
  // Nomenclature ERP: has Qté, N°Lot, Pér., and lots of rows
  if(cols.includes('Qté')&&cols.includes('N°Lot')&&cols.includes('Pér.')&&data.length>5000)return importNomenclature(data);
  if(cols.includes('Qté')&&cols.includes('P. Achat')&&cols.includes('Pér.'))return importNomenclature(data);
  // Monthly: has Date, Q.Entrée, Q.Sortie
  if(cols.includes('Date')&&(cols.includes('Q.Entrée')||cols.includes('Q.Sortie')))return importMonthly(data,fileName);
  // Rotation: has Q.Stock, Q.Entrées, Q.Sorties
  if(cols.includes('Q.Stock')&&cols.includes('Q.Entrées'))return importRotation(data);
  return 'unknown';
}

function importRotation(data){
  DB.rotation=data.filter(r=>r['Désignation/Nom commercial']).map(r=>({
    name:san(r['Désignation/Nom commercial']),stock:Number(r['Q.Stock'])||0,
    entries:Number(r['Q.Entrées'])||0,exits:Number(r['Q.Sorties'])||0,
    dci:r.dci?san(r.dci):null,labo:r.labo?san(r.labo):null
  }));
  DB.importStatus.rotation=true;
  return 'rotation';
}

function importMonthly(data,fileName){
  const rows=data.filter(r=>r['Désignation/Nom commercial']).map(r=>{
    const date=excelDate(r['Date']);
    return{date,mk:monthKey(date),name:san(r['Désignation/Nom commercial']),
      qty_in:Number(r['Q.Entrée'])||0,qty_out:Number(r['Q.Sortie'])||0,
      supplier:r['Fournisseur/Client/Pharmacien']?String(r['Fournisseur/Client/Pharmacien']).trim():null,
      p_achat:Number(r['P. Achat'])||0,p_vente:Number(r['P. vente'])||0,
      type:r['T']||null,lot:r['N°Lot']?String(r['N°Lot']):null,
      peremption:excelDate(r['Pér.']),barcode:r['Code barre']?String(r['Code barre']):null};
  });
  const mk=rows.find(r=>r.mk)?.mk||fileName;
  DB.monthly[mk]=(DB.monthly[mk]||[]).concat(rows);
  DB.importStatus.monthly=Object.keys(DB.monthly).length;
  return 'monthly';
}

function importNomenclature(data){
  DB.nomenclature=data.filter(r=>r['Désignation/Nom commercial']).map(r=>({
    name:san(r['Désignation/Nom commercial']),qty:Number(r['Qté'])||0,
    p_achat:Number(r['P. Achat'])||0,p_vente:Number(r['P. vente'])||0,
    lot:r['N°Lot']?String(r['N°Lot']):null,peremption:excelDate(r['Pér.']),
    dateAchat:excelDate(r['Date Achat']),fb:r['F/B']||null,
    shp:Number(r['SHP'])||0,barcode:r['Code barre']?String(r['Code barre']):null
  }));
  DB.importStatus.nomenclature=true;
  return 'nomenclature';
}

// V4.1: Import Chifa AI DCI database (replaces old national DCI)
function importChifaDCI(raw,headerIdx,fileName,allSheets,sheetNames){
  const headers=raw[headerIdx];
  const colIdx={};
  headers.forEach((h,i)=>{
    const s=String(h||'').toUpperCase();
    if(s.includes('DCI')&&!s.includes('TARIF'))colIdx.dci=i;
    else if(s.includes('SIGNATION'))colIdx.designation=i;
    else if(s==='CODE'||s.includes('CODE'))colIdx.code=i;
    else if(s.includes('TARIF'))colIdx.tarif=i;
  });
  const items=[];
  const dciCodeCounts={}; // dciCode → {name→count} for canonical name selection
  for(let i=headerIdx+1;i<raw.length;i++){
    const row=raw[i];if(!row)continue;
    const designation=String(row[colIdx.designation]||'').trim().toUpperCase();
    const dciField=String(row[colIdx.dci]||'').trim().toUpperCase();
    if(!designation||!dciField)continue;
    // Parse DCI field: "01A003 CETIRIZINE" → code + name
    const spIdx=dciField.indexOf(' ');
    const dciCode=spIdx>0?dciField.substring(0,spIdx).trim():'';
    let dciName=spIdx>0?dciField.substring(spIdx+1).trim():dciField;
    // Clean up DCI name: remove salt suffixes for canonical grouping
    const dciNameClean=dciName.replace(/[\s,]*(SOUS FORME|S\/F|CHLORHYDRATE|DICHLORHYDRATE|DIHYDROCHLORHYDE|MALEATE|SULFATE|FUMARATE|TARTRATE|SUCCINATE|BROMHYDRATE|PHOSPHATE|ACETATE|CITRATE|BESYLATE|MESYLATE|LYSINATE|SODIQUE|POTASSIQUE|CALCIQUE|DE BASE|BASE|EXPRIME EN).*$/i,'').replace(/[,;.]+$/,'').trim();
    const brand=extractBrand(designation);
    const dosage=extractDosage(designation);
    const code=colIdx.code!=null?String(row[colIdx.code]||'').trim():'';
    const tarif=colIdx.tarif!=null?Number(row[colIdx.tarif])||0:0;
    // Detect form from designation
    let form='';
    const fMatch=designation.match(/\b(COMP|GELULE|GLES|GEL|PDRE|AMP|INJ|SUPPO|SPRAY|SIROP|SIR|CREME|POMMADE|COLLYRE|SOL|SACHET|CAPS|PATCH|SUSP|OVULE|GTTES|GOUTTES)\b\.?/i);
    if(fMatch)form=fMatch[1].toUpperCase();
    items.push({
      dci:dciName,dciClean:dciNameClean,dciCode,brand:brand||designation.split(/\s+/)[0],
      dosage:dosage||'',form,code,tarif,designation,withdrawn:false
    });
    // Track DCI code → clean name frequencies
    if(dciCode){
      if(!dciCodeCounts[dciCode])dciCodeCounts[dciCode]={};
      dciCodeCounts[dciCode][dciNameClean]=(dciCodeCounts[dciCode][dciNameClean]||0)+1;
    }
  }
  // Build canonical DCI name per code (most frequent clean name)
  const canonicalDCI={}; // dciCode → canonical clean name
  Object.entries(dciCodeCounts).forEach(([code,names])=>{
    let best='',bestCount=0;
    Object.entries(names).forEach(([name,count])=>{if(count>bestCount){bestCount=count;best=name;}});
    canonicalDCI[code]=best;
  });
  // Apply canonical names to items
  items.forEach(item=>{
    if(item.dciCode&&canonicalDCI[item.dciCode])item.dci=canonicalDCI[item.dciCode];
  });
  // Build unique DCI names list for dropdown (~1676 entries)
  DB.uniqueDCINames=Object.values(canonicalDCI).filter(n=>n).sort();

  // Detect retraits from other sheets (same logic as before)
  DB.retraits=[];DB._withdrawnBrands=new Set();
  if(allSheets&&sheetNames){
    for(const sn of sheetNames){
      const snUpper=sn.toUpperCase();
      if(snUpper.includes('RETRAIT')||snUpper.includes('RETIRE')||snUpper.includes('RETIRÉ')){
        const sheetData=allSheets[sn];if(!sheetData||sheetData.length<2)continue;
        let retHeaderIdx=0;
        for(let i=0;i<Math.min(10,sheetData.length);i++){
          const row=sheetData[i];if(!row)continue;
          const vals=row.filter(v=>v!=null&&String(v).trim()!=='');
          if(vals.length>=2){retHeaderIdx=i;break;}
        }
        const retHeaders=sheetData[retHeaderIdx];const retCols={};
        if(retHeaders){retHeaders.forEach((h,i)=>{
          const s=String(h||'').toUpperCase();
          if(s.includes('DCI')||s.includes('DENOMINATION'))retCols.dci=i;
          else if(s.includes('MARQUE')||s.includes('DESIGNATION')||s.includes('NOM'))retCols.brand=i;
          else if(s.includes('DOSAGE'))retCols.dosage=i;
          else if(s.includes('CODE'))retCols.code=i;
        });}
        for(let i=retHeaderIdx+1;i<sheetData.length;i++){
          const row=sheetData[i];if(!row)continue;
          let brand=retCols.brand!=null?String(row[retCols.brand]||'').trim().toUpperCase():null;
          const dosage=retCols.dosage!=null?String(row[retCols.dosage]||'').trim().toUpperCase():null;
          if(!brand){for(let j=0;j<row.length;j++){if(row[j]!=null&&String(row[j]).trim()){brand=String(row[j]).trim().toUpperCase();break;}}}
          if(!brand)continue;
          DB.retraits.push({brand,dosage:dosage||null});
          DB._withdrawnBrands.add(brand);DB._withdrawnBrands.add(brand.split(/\s+/)[0]);
          if(dosage)DB._withdrawnBrands.add(brand+'|'+normalizeDosage(dosage));
        }
      }
    }
  }
  // Mark withdrawn in items
  items.forEach(item=>{
    const preciseKey=item.brand+'|'+normalizeDosage(item.dosage);
    if(DB._withdrawnBrands.has(preciseKey)||DB._withdrawnBrands.has(item.brand))item.withdrawn=true;
  });
  DB.nationalDCI=items.filter(item=>!item.withdrawn);
  DB.nationalDCI_all=items;
  DB.importStatus.chifaDCI=true;
  DB.importStatus.retraits=DB.retraits.length;
  buildDCIIndex();
  return 'chifaDCI';
}

// ==================== V4.1: DCI INDEX BUILDER (Chifa) ====================
function buildDCIIndex(){
  DB._brandIndex={};DB._byCode={};DB._dciDosageIndex={};
  DB.nationalDCI.forEach(item=>{
    if(!item.brand)return;
    const brandNorm=item.brand.trim().toUpperCase().replace(/\s+/g,' ');
    const words=brandNorm.split(' ');
    const keys=new Set();
    keys.add(brandNorm);
    if(words.length>=2)keys.add(words.slice(0,2).join(' '));
    keys.add(words[0]);
    const entry={dci:item.dci,dosage:item.dosage,form:item.form,code:item.code,
      brand:item.brand,dciCode:item.dciCode||'',tarif:item.tarif||0,
      normDosage:normalizeDosage(item.dosage)};
    keys.forEach(k=>{if(!DB._brandIndex[k])DB._brandIndex[k]=[];DB._brandIndex[k].push(entry);});
    if(item.code){
      if(!DB._byCode[item.code])DB._byCode[item.code]={dci:item.dci,dosage:item.dosage,form:item.form,brands:[]};
      DB._byCode[item.code].brands.push({brand:item.brand,dciCode:item.dciCode});
    }
    const dciDosKey=(item.dci+'|'+normalizeDosage(item.dosage)).toUpperCase();
    if(!DB._dciDosageIndex[dciDosKey])DB._dciDosageIndex[dciDosKey]=[];
    DB._dciDosageIndex[dciDosKey].push(entry);
  });
}

// V3: Strict brand+dosage matching — NEVER mix dosages
function matchProductToDCI(productName){
  if(!DB._brandIndex)return null;
  const brand=extractBrand(productName);
  if(!brand)return null;
  const dosage=extractDosage(productName);
  const normDos=normalizeDosage(dosage);

  // Build progressive key list: full brand → first 2 words → first word
  const brandNorm=brand.trim().toUpperCase().replace(/\s+/g,' ');
  const words=brandNorm.split(' ');
  const tryKeys=[];
  tryKeys.push(brandNorm);
  if(words.length>=2)tryKeys.push(words.slice(0,2).join(' '));
  if(words.length>=1)tryKeys.push(words[0]);

  for(const key of tryKeys){
    const candidates=DB._brandIndex[key];
    if(!candidates||candidates.length===0)continue;

    if(dosage&&normDos){
      // STRICT dosage match: exact normDosage
      for(const c of candidates){
        if(c.normDosage===normDos)return c;
      }
      // Flexible: numeric+unit match
      const partsA=normDos.match(/^([\d.]+)(.*)$/);
      if(partsA){
        for(const c of candidates){
          const partsB=(c.normDosage||'').match(/^([\d.]+)(.*)$/);
          if(partsB&&partsA[1]===partsB[1]&&partsA[2]===partsB[2])return c;
        }
      }
      // Flexible: product dosage appears inside candidate dosage (compound match)
      // e.g. product "100MG" matches candidate "100MG/12.5MG/ML"
      // or product "400MG/5ML" matches "400MG/57MG/5ML"
      for(const c of candidates){
        const cd=c.normDosage||'';
        if(cd.includes('/')&&normDos){
          // Extract main strength from compound: "875MG/125MG" → "875MG"
          const mainCandidate=cd.split('/')[0];
          const mainProduct=normDos.split('/')[0];
          const pmA=mainProduct.match(/^([\d.]+)(.*)/);
          const pmB=mainCandidate.match(/^([\d.]+)(.*)/);
          if(pmA&&pmB&&pmA[1]===pmB[1]&&pmA[2]===pmB[2])return c;
        }
      }
      // Flexible: percentage to concentration (0.05% → known entries)
      if(normDos.includes('%')){
        for(const c of candidates){
          if((c.dosage||'').includes(normDos.replace(/^0+/,'')))return c;
          if((c.dosage||'').includes(dosage))return c;
        }
      }
      // Flexible: candidate dosage string contains the raw extracted dosage
      for(const c of candidates){
        if(c.dosage&&dosage&&c.dosage.replace(/\s+/g,'').includes(dosage.replace(/\s+/g,'')))return c;
      }
      // If brand found but NO dosage matched: still better to match with DCI info
      // than to lose the product entirely — pick closest or first candidate
      // Mark as dosage-approximate match
      if(candidates.length>0){
        const match={...candidates[0],dosageApprox:true};
        return match;
      }
    }

    // No dosage in product name
    if(!dosage){
      const uniqueDosages=new Set(candidates.map(c=>c.normDosage));
      if(uniqueDosages.size===1)return candidates[0];
      // If ambiguous but all same DCI, still return (we know the DCI even if dosage unclear)
      const uniqueDCI=new Set(candidates.map(c=>c.dci));
      if(uniqueDCI.size===1)return {...candidates[0],dosageApprox:true};
      return null;
    }
  }
  return null;
}

// V3: Get all available generics for a DCI+dosage from national DB
function getGenericsForDCI(dci,dosage){
  if(!DB._dciDosageIndex||!dci)return [];
  const normDos=normalizeDosage(dosage);
  const key=(dci+'|'+normDos).toUpperCase();
  return DB._dciDosageIndex[key]||[];
}

// ==================== COMPUTATION ENGINE ====================
function computeAll(){
  const products={};
  const now=new Date();
  const sortedMonths=Object.keys(DB.monthly).sort();

  // Step 1: Build product index from nomenclature (primary stock source)
  const nomencByProduct={};
  DB.nomenclature.forEach(r=>{
    if(!nomencByProduct[r.name])nomencByProduct[r.name]={lots:[],totalQty:0,latestPrice:null,latestDate:null};
    const np=nomencByProduct[r.name];
    np.lots.push(r);
    np.totalQty+=r.qty;
    if(r.p_achat>0&&(!np.latestDate||(r.dateAchat&&r.dateAchat>np.latestDate))){
      np.latestPrice=r.p_achat;np.latestPVente=r.p_vente;np.latestDate=r.dateAchat;
    }
  });

  // Initialize products from nomenclature (stock reference)
  Object.entries(nomencByProduct).forEach(([name,data])=>{
    products[name]={name,dci:null,labo:null,stock:data.totalQty,
      yearlyEntries:0,yearlyExits:0,monthlyExits:{},monthlyEntries:{},
      suppliers:{},lots:data.lots,p_achat:data.latestPrice||0,p_vente:data.latestPVente||0,
      margin:0,abc:'C',xyz:'Z',riskScore:0,dciCoverage:null,dciCode:null,
      category:'autre',trend:1.0,expiredQty:0,nearExpiryQty:0,effectiveStock:0,
      dailyConsumption:0,daysRemaining:9999,targetStock:0,suggestedPurchase:0,purchaseCost:0,
      avgMonthlyExits:0,avgDailyExits:0,seasonalIndex:{},cv:999,
      bestSupplier:null,bestPrice:Infinity,supplierCount:0,
      alertLevel:'dead',alertLabel:'Inactif',yearlyRevenue:0,
      dciGroupCovered:false,dciGroupDays:null};
  });

  // Step 2: Enrich from rotation (DCI, labo metadata)
  DB.rotation.forEach(r=>{
    if(!products[r.name]){
      products[r.name]={name:r.name,dci:null,labo:null,stock:r.stock,
        yearlyEntries:r.entries,yearlyExits:r.exits,monthlyExits:{},monthlyEntries:{},
        suppliers:{},lots:[],p_achat:0,p_vente:0,margin:0,abc:'C',xyz:'Z',riskScore:0,
        dciCoverage:null,dciCode:null,category:'autre',trend:1.0,expiredQty:0,nearExpiryQty:0,
        effectiveStock:0,dailyConsumption:0,daysRemaining:9999,targetStock:0,suggestedPurchase:0,
        purchaseCost:0,avgMonthlyExits:0,avgDailyExits:0,seasonalIndex:{},cv:999,
        bestSupplier:null,bestPrice:Infinity,supplierCount:0,
        alertLevel:'dead',alertLabel:'Inactif',yearlyRevenue:0,
        dciGroupCovered:false,dciGroupDays:null};
    }
    const p=products[r.name];
    if(r.dci)p.dci=r.dci;
    if(r.labo)p.labo=r.labo;
    if(r.dci)p.category='medicament';
    if(!DB.importStatus.nomenclature){p.stock=r.stock;p.yearlyEntries=r.entries;p.yearlyExits=r.exits;}
    else{p.yearlyEntries=r.entries;p.yearlyExits=r.exits;}
  });

  // Step 3: Process monthly data for seasonality & suppliers
  sortedMonths.forEach(mk=>{
    DB.monthly[mk].forEach(r=>{
      if(!products[r.name])products[r.name]={name:r.name,dci:null,labo:null,stock:0,yearlyEntries:0,yearlyExits:0,monthlyExits:{},monthlyEntries:{},suppliers:{},lots:[],p_achat:0,p_vente:0,margin:0,abc:'C',xyz:'Z',riskScore:0,dciCoverage:null,dciCode:null,category:'autre',trend:1.0,expiredQty:0,nearExpiryQty:0,effectiveStock:0,dailyConsumption:0,daysRemaining:9999,targetStock:0,suggestedPurchase:0,purchaseCost:0,avgMonthlyExits:0,avgDailyExits:0,seasonalIndex:{},cv:999,bestSupplier:null,bestPrice:Infinity,supplierCount:0,alertLevel:'dead',alertLabel:'Inactif',yearlyRevenue:0,dciGroupCovered:false,dciGroupDays:null};
      const p=products[r.name];
      if(r.qty_out>0){p.monthlyExits[mk]=(p.monthlyExits[mk]||0)+r.qty_out;}
      if(r.qty_in>0){p.monthlyEntries[mk]=(p.monthlyEntries[mk]||0)+r.qty_in;}
      // Supplier prices with dates
      if(r.qty_in>0&&r.supplier&&r.supplier!=='0'){
        if(!p.suppliers[r.supplier])p.suppliers[r.supplier]={entries:[],totalQty:0};
        p.suppliers[r.supplier].entries.push({price:r.p_achat,date:r.date,qty:r.qty_in});
        p.suppliers[r.supplier].totalQty+=r.qty_in;
      }
      if(r.p_achat>0)p.p_achat=r.p_achat;
      if(r.p_vente>0)p.p_vente=r.p_vente;
    });
  });

  // Step 4: V4.1 — Match products to Chifa DCI database (strict brand+dosage)
  if(DB.importStatus.chifaDCI){
    Object.values(products).forEach(p=>{
      const match=matchProductToDCI(p.name);
      if(match){
        p.dciCode=match.dciCode||match.code;
        p.matchedDosage=match.normDosage||normalizeDosage(match.dosage);
        p.matchedBrand=match.brand;
        p.matchedForm=match.form;
        p.dci=match.dci;
        p.category='medicament';
      }
    });
  }

  // Step 4a-V4.1: Apply manual DCI corrections + category tags
  if(DB.manualDCI){
    Object.entries(DB.manualDCI).forEach(([name,corr])=>{
      const p=products[name];if(!p)return;
      if(corr.dci){p.dci=corr.dci;p.category='medicament';}
      if(corr.dosage)p.matchedDosage=normalizeDosage(corr.dosage);
      if(corr.category){p.manualCategory=corr.category;p.category='parapharm';}
      p.manualDCI=true;
    });
  }

  // Step 4a-bis: V3 — Mark products that are WITHDRAWN (retraits) from market
  if(DB._withdrawnBrands&&DB._withdrawnBrands.size>0){
    Object.values(products).forEach(p=>{
      p.withdrawn=false;
      const brand=extractBrand(p.name);
      if(!brand)return;
      const brandNorm=brand.trim().toUpperCase();
      const dosage=extractDosage(p.name);
      const normDos=normalizeDosage(dosage);
      // Check precise match (brand+dosage) first, then brand-only
      if(normDos&&DB._withdrawnBrands.has(brandNorm+'|'+normDos)){
        p.withdrawn=true;
      }else if(DB._withdrawnBrands.has(brandNorm)){
        p.withdrawn=true;
      }else{
        // Also check first word of brand
        const firstWord=brandNorm.split(/\s+/)[0];
        if(DB._withdrawnBrands.has(firstWord)){
          // Only mark if we have a more specific match (check retraits list)
          const retMatch=DB.retraits.find(r=>{
            const rFirst=r.brand.split(/\s+/)[0];
            if(rFirst!==firstWord)return false;
            // If retrait has dosage, must match our dosage
            if(r.dosage&&normDos){
              return normalizeDosage(r.dosage)===normDos;
            }
            // If retrait brand matches our full brand
            return r.brand===brandNorm;
          });
          if(retMatch)p.withdrawn=true;
        }
      }
    });
  }

  // Step 4b: V3 — Detect & merge duplicate products (same brand+dosage = same medicine)
  if(DB.importStatus.chifaDCI){
    const dupGroups={};// key: "matchedBrand|normDosage" → [product names]
    Object.values(products).forEach(p=>{
      if(!p.matchedBrand||!p.matchedDosage)return;
      const key=p.matchedBrand+'|'+p.matchedDosage;
      if(!dupGroups[key])dupGroups[key]=[];
      dupGroups[key].push(p.name);
    });
    DB._mergedProducts={};
    Object.entries(dupGroups).forEach(([key,names])=>{
      if(names.length<=1)return;
      // Pick canonical: the one with most stock
      names.sort((a,b)=>(products[b].stock||0)-(products[a].stock||0));
      const canonical=names[0];
      const canon=products[canonical];
      canon._mergedNames=[canonical];
      for(let i=1;i<names.length;i++){
        const dup=products[names[i]];
        // Merge stock, lots, consumption
        canon.stock+=dup.stock;
        canon.lots=canon.lots.concat(dup.lots);
        canon.yearlyEntries+=dup.yearlyEntries;
        canon.yearlyExits+=dup.yearlyExits;
        // Merge monthly data
        Object.entries(dup.monthlyExits).forEach(([mk,v])=>{canon.monthlyExits[mk]=(canon.monthlyExits[mk]||0)+v});
        Object.entries(dup.monthlyEntries).forEach(([mk,v])=>{canon.monthlyEntries[mk]=(canon.monthlyEntries[mk]||0)+v});
        // Merge suppliers
        Object.entries(dup.suppliers).forEach(([sup,data])=>{
          if(!canon.suppliers[sup])canon.suppliers[sup]={entries:[],totalQty:0};
          canon.suppliers[sup].entries=canon.suppliers[sup].entries.concat(data.entries);
          canon.suppliers[sup].totalQty+=data.totalQty;
        });
        // Use latest price
        if(dup.p_achat>0&&(!canon.p_achat||dup.p_achat))canon.p_achat=dup.p_achat;
        if(dup.p_vente>0)canon.p_vente=dup.p_vente;
        canon._mergedNames.push(names[i]);
        DB._mergedProducts[names[i]]=canonical;
        delete products[names[i]]; // Remove duplicate
      }
    });
  }

  // Step 5: Compute per-product metrics
  const threeMonths=new Date(now.getTime()+90*864e5);
  const allExitsValues=[];

  Object.values(products).forEach(p=>{
    // Expiry from lots
    let expired=0,nearExp=0;
    p.lots.forEach(l=>{
      const exp=excelDate(l.peremption);
      if(exp&&exp<now)expired+=l.qty;
      else if(exp&&exp<threeMonths)nearExp+=l.qty;
    });
    p.expiredQty=expired;p.nearExpiryQty=nearExp;
    p.effectiveStock=Math.max(0,p.stock-expired);

    // Seasonality
    const monthValues={};
    Object.entries(p.monthlyExits).forEach(([mk,qty])=>{
      const m=parseInt(mk.split('-')[1]);
      if(!monthValues[m])monthValues[m]=[];
      monthValues[m].push(qty);
    });
    const monthAvgs=[];
    for(let m=1;m<=12;m++){
      const vals=monthValues[m]||[0];
      const avg=vals.reduce((a,b)=>a+b,0)/vals.length;
      p.seasonalIndex[m]=avg;monthAvgs.push(avg);
    }
    const overallAvg=monthAvgs.reduce((a,b)=>a+b,0)/12;
    for(let m=1;m<=12;m++)p.seasonalIndex[m]=overallAvg>0?p.seasonalIndex[m]/overallAvg:1;
    p.avgMonthlyExits=overallAvg;p.avgDailyExits=overallAvg/30;

    const totalFromMonthly=Object.values(p.monthlyExits).reduce((a,b)=>a+b,0);
    if(totalFromMonthly>0)p.yearlyExits=Math.max(p.yearlyExits,totalFromMonthly);

    // Trend
    const recent=sortedMonths.slice(-3).map(mk=>p.monthlyExits[mk]||0);
    const recentAvg=recent.reduce((a,b)=>a+b,0)/3;
    p.trend=overallAvg>0?Math.max(0.3,Math.min(3,recentAvg/overallAvg)):1;

    // XYZ
    const mVals=Object.values(p.monthlyExits);
    if(mVals.length>=3){
      const mean=mVals.reduce((a,b)=>a+b,0)/mVals.length;
      const variance=mVals.reduce((a,b)=>a+(b-mean)**2,0)/mVals.length;
      p.cv=mean>0?Math.sqrt(variance)/mean:999;
    }
    p.xyz=p.cv<0.3?'X':p.cv<0.6?'Y':'Z';

    // Consumption & days remaining
    const curMonth=now.getMonth()+1;
    const seasonalRate=p.avgDailyExits*(p.seasonalIndex[curMonth]||1);
    p.dailyConsumption=seasonalRate>0?seasonalRate:p.yearlyExits/365;
    p.daysRemaining=p.dailyConsumption>0?p.effectiveStock/p.dailyConsumption:9999;

    // V4: ABC/XYZ-modulated target months (was flat 3 months in V3)
    const _tm={'AX':3,'AY':2.5,'AZ':2,'BX':2.5,'BY':2,'BZ':1.5,'CX':2,'CY':1.5,'CZ':1};
    const tMonths=DB.settings.targetMonths&&DB.settings.targetMonths[p.abc+p.xyz]!=null?DB.settings.targetMonths[p.abc+p.xyz]:(_tm[p.abc+p.xyz]||2);
    const growthMult=1+(DB.settings.growth_categories[p.category]||DB.settings.growth_global)/100;
    let target=0;
    const fullM=Math.floor(tMonths);
    for(let i=0;i<fullM;i++){const fm=((curMonth-1+i)%12)+1;target+=p.avgMonthlyExits*(p.seasonalIndex[fm]||1)*p.trend*growthMult;}
    const partFrac=tMonths-fullM;
    if(partFrac>0){const fm=((curMonth-1+fullM)%12)+1;target+=p.avgMonthlyExits*(p.seasonalIndex[fm]||1)*p.trend*growthMult*partFrac;}
    p.targetStock=Math.ceil(target);p._targetMonths=tMonths;
    // V3: Withdrawn products — NEVER suggest purchasing them
    if(p.withdrawn){
      p.suggestedPurchase=0;
      p.purchaseCost=0;
    }else{
      p.suggestedPurchase=Math.max(0,p.targetStock-p.effectiveStock);
      p.purchaseCost=p.suggestedPurchase*p.p_achat;
    }

    // Revenue & margin
    p.yearlyRevenue=p.yearlyExits*p.p_vente;
    p.margin=p.p_achat>0?(p.p_vente-p.p_achat)/p.p_achat:0;

    // Supplier summary with latest prices
    p.supplierCount=Object.keys(p.suppliers).length;
    p.bestSupplier=null;p.bestPrice=Infinity;p.secondBestSupplier=null;p.secondBestPrice=Infinity;
    const supSummaries=[];
    Object.entries(p.suppliers).forEach(([sup,data])=>{
      // Sort by date descending to get latest
      const sorted=data.entries.filter(e=>e.price>0).sort((a,b)=>(b.date||0)-(a.date||0));
      const latest=sorted[0];
      if(!latest)return;
      data.latestPrice=latest.price;data.latestDate=latest.date;
      data.avgPrice=data.entries.reduce((a,e)=>a+e.price,0)/data.entries.length;
      supSummaries.push({name:sup,latestPrice:latest.price,latestDate:latest.date,totalQty:data.totalQty,entries:data.entries.length});
    });
    // Sort by latest price
    supSummaries.sort((a,b)=>a.latestPrice-b.latestPrice);
    if(supSummaries[0]){p.bestSupplier=supSummaries[0].name;p.bestPrice=supSummaries[0].latestPrice;p.bestPriceDate=supSummaries[0].latestDate;}
    if(supSummaries[1]){p.secondBestSupplier=supSummaries[1].name;p.secondBestPrice=supSummaries[1].latestPrice;p.secondBestPriceDate=supSummaries[1].latestDate;}
    p._supSummaries=supSummaries;

    allExitsValues.push({name:p.name,revenue:p.yearlyRevenue});
  });

  // ABC classification
  allExitsValues.sort((a,b)=>b.revenue-a.revenue);
  const totalRev=allExitsValues.reduce((a,b)=>a+b.revenue,0);
  let cum=0;
  allExitsValues.forEach(item=>{cum+=item.revenue;if(products[item.name])products[item.name].abc=cum/totalRev<=0.8?'A':cum/totalRev<=0.95?'B':'C';});

  // Step 6: V3 — DCI group coverage (STRICT by DCI name + normalized dosage)
  // Groups are ONLY products with same DCI molecule AND same dosage
  // V4.1: Category grouping for non-DCI products (cosmétiques/articles)
  DB._categoryGroups={};
  Object.values(products).forEach(p=>{
    if(p.dci||!p.manualCategory)return;
    const cat=p.manualCategory;
    if(!DB._categoryGroups[cat])DB._categoryGroups[cat]={category:cat,products:[],totalStock:0,totalDaily:0};
    DB._categoryGroups[cat].products.push(p);
    DB._categoryGroups[cat].totalStock+=p.effectiveStock;
    DB._categoryGroups[cat].totalDaily+=p.dailyConsumption;
  });
  Object.values(DB._categoryGroups).forEach(group=>{
    const gd=group.totalDaily>0?group.totalStock/group.totalDaily:9999;
    group.groupDays=gd;
    group.products.forEach(p=>{p.categoryGroupDays=gd;p.categoryGroupCount=group.products.length;p.categoryGroupStock=group.totalStock;});
  });

  DB._dciGroups={};
  if(DB.importStatus.chifaDCI){
    Object.values(products).forEach(p=>{
      if(!p.dci||!p.matchedDosage)return;
      const gKey=(p.dci+'|'+p.matchedDosage).toUpperCase();
      if(!DB._dciGroups[gKey])DB._dciGroups[gKey]={dci:p.dci,dosage:p.matchedDosage,products:[],totalStock:0,totalDaily:0};
      DB._dciGroups[gKey].products.push(p);
      DB._dciGroups[gKey].totalStock+=p.effectiveStock;
      DB._dciGroups[gKey].totalDaily+=p.dailyConsumption;
    });
    // Calculate group coverage — mark products
    Object.values(DB._dciGroups).forEach(group=>{
      const groupDays=group.totalDaily>0?group.totalStock/group.totalDaily:9999;
      group.groupDays=groupDays;
      // Get ALL generics from national DB for this DCI+dose
      const allGenerics=getGenericsForDCI(group.dci,group.dosage);
      group.totalGenericsInDB=allGenerics.length;
      // Brands in our inventory for this group
      const ourBrands=new Set(group.products.map(p=>p.matchedBrand));
      // Generics we DON'T have in stock
      group.missingGenerics=allGenerics.filter(g=>!ourBrands.has(g.brand));

      group.products.forEach(p=>{
        p.dciGroupDays=groupDays;
        p.dciGroupCount=group.products.length;
        p.dciGroupStock=group.totalStock;
        p.dciGroupTotalGenerics=allGenerics.length;
        // Covered = group has >1 product AND enough stock days
        // This means another generic with same DCI+dosage has stock
        if(groupDays>DB.settings.alert_securite&&group.products.length>1){
          p.dciGroupCovered=true;
        }
        // Attach missing generics (for purchase suggestions)
        p.missingGenerics=group.missingGenerics;
        p.allDCIGenerics=allGenerics;
      });
    });
  }

  // DCI coverage (including unmatched products, from rotation DCI field)
  const dciProducts={};
  Object.values(products).forEach(p=>{if(p.dci){if(!dciProducts[p.dci])dciProducts[p.dci]=[];dciProducts[p.dci].push(p);}});
  Object.values(products).forEach(p=>{
    if(p.dci&&dciProducts[p.dci]){
      const siblings=dciProducts[p.dci];
      const ts=siblings.reduce((a,b)=>a+b.effectiveStock,0);
      const td=siblings.reduce((a,b)=>a+b.dailyConsumption,0);
      p.dciCoverage={count:siblings.length,totalStock:ts,totalDays:td>0?ts/td:9999};
    }
  });

  // Alert levels
  Object.values(products).forEach(p=>{
    // V3: Withdrawn products get special alert level
    if(p.withdrawn){p.alertLevel='withdrawn';p.alertLabel='⛔ RETIRÉ';}
    else if(p.dailyConsumption<=0&&p.yearlyExits<=0){p.alertLevel='dead';p.alertLabel='Inactif';}
    else if(p.daysRemaining<=0){p.alertLevel='rupture';p.alertLabel='RUPTURE';}
    else if(p.daysRemaining<=DB.settings.alert_rupture){p.alertLevel='5j';p.alertLabel=`≤${DB.settings.alert_rupture}j`;}
    else if(p.daysRemaining<=DB.settings.alert_securite){p.alertLevel='15j';p.alertLabel=`≤${DB.settings.alert_securite}j`;}
    else if(p.daysRemaining>DB.settings.surstock){p.alertLevel='surstock';p.alertLabel='Surstock';}
    else{p.alertLevel='ok';p.alertLabel='OK';}

    // Risk score
    let risk=0;
    if(p.daysRemaining<=0)risk+=30;else if(p.daysRemaining<=5)risk+=25;else if(p.daysRemaining<=15)risk+=15;else if(p.daysRemaining<=30)risk+=8;
    risk+=p.abc==='A'?25:p.abc==='B'?12:3;
    if(!p.dciCoverage||p.dciCoverage.count<=1)risk+=20;else if(p.dciCoverage.totalDays<15)risk+=12;else if(p.dciCoverage.totalDays<30)risk+=5;
    risk+=p.xyz==='Z'?15:p.xyz==='Y'?8:3;
    if(p.nearExpiryQty>p.effectiveStock*0.3)risk+=10;else if(p.nearExpiryQty>0)risk+=4;
    p.riskScore=Math.min(100,Math.round(risk));
  });

  // Build supplier index
  DB.suppliers={};
  Object.values(products).forEach(p=>{
    Object.entries(p.suppliers).forEach(([sup,data])=>{
      if(!DB.suppliers[sup])DB.suppliers[sup]={name:sup,products:{},totalSpend:0,orderCount:0};
      DB.suppliers[sup].products[p.name]={latestPrice:data.latestPrice,latestDate:data.latestDate,totalQty:data.totalQty};
      DB.suppliers[sup].totalSpend+=(data.avgPrice||0)*data.totalQty;
      DB.suppliers[sup].orderCount+=data.entries.length;
    });
  });

  DB.products=products;DB.loaded=true;
  localStorage.setItem('leghrib_pharmacy_settings',JSON.stringify(DB.settings));
}

// ==================== PAGE RENDERING ====================
let currentPage='import',sortCol=null,sortDir=1,alertsPage=0,alertsFilter={search:'',level:'all',abc:'all'};
const ROWS=50;

function showPage(page){
  currentPage=page;
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.toggle('active',n.dataset.page===page));
  const m=document.getElementById('mainContent');
  ({import:renderImport,dashboard:renderDashboard,alerts:renderAlerts,dciMatch:renderDCIMatch,suppliers:renderSuppliers,purchase:renderPurchase,expiry:renderExpiry,settings:renderSettings})[page](m);
}

// ==================== IMPORT PAGE ====================
function renderImport(el){
  const s=DB.importStatus;
  const matched=DB.importStatus.chifaDCI?Object.values(DB.products).filter(p=>p.dciCode).length:0;
  el.innerHTML=`
    <h2 class="page-title">Importation des Données</h2>
    <p class="page-subtitle">Glissez vos fichiers ici — le système détecte automatiquement le type</p>
    <div class="import-zone" id="dropZone" onclick="document.getElementById('fileInput').click()">
      <div class="import-icon">📁</div>
      <h3>Glissez vos fichiers ici</h3>
      <p>Nomenclature ERP, fichiers mensuels, rotation annuelle, Médicaments Chifa AI<br>Sélection multiple acceptée — tous formats .xlsx</p>
      <input type="file" class="hidden-input" id="fileInput" accept=".xlsx,.xls" multiple onchange="handleAllFiles(this.files)">
    </div>
    <div class="import-status-grid">
      <div class="import-status"><span class="dot ${s.nomenclature?'dot-green':'dot-gray'}"></span>${s.nomenclature?`✓ Nomenclature ERP — ${DB.nomenclature.length.toLocaleString()} lots chargés`:'◯ Nomenclature ERP (stock quotidien)'}</div>
      <div class="import-status"><span class="dot ${s.monthly>0?'dot-green':'dot-gray'}"></span>${s.monthly>0?`✓ Fichiers mensuels — ${s.monthly} mois chargés`:'◯ Fichiers mensuels (historique ventes)'}</div>
      <div class="import-status"><span class="dot ${s.rotation?'dot-green':'dot-gray'}"></span>${s.rotation?`✓ Rotation annuelle — ${DB.rotation.length} produits`:'◯ Rotation annuelle — optionnel (enrichissement DCI/labo)'}</div>
      <div class="import-status"><span class="dot ${s.chifaDCI?'dot-green':'dot-gray'}"></span>${s.chifaDCI?`✓ Médicaments Chifa AI — ${DB.nationalDCI.length} médicaments, ${matched} matchés${s.retraits>0?' | ⛔ '+s.retraits+' retraits chargés':''}`:'◯ Médicaments Chifa AI (base DCI nationale)'}</div>
    </div>
    <div style="margin-top:24px;text-align:center">
      <button class="btn btn-primary" onclick="runCompute()" style="padding:12px 32px;font-size:15px" ${!s.nomenclature&&!s.rotation&&s.monthly===0?'disabled style="opacity:.5;padding:12px 32px;font-size:15px"':''}>🔄 Calculer les Prévisions</button>
      <button class="btn btn-secondary" onclick="clearAll()" style="padding:12px 24px;font-size:15px;margin-left:12px">🗑️ Réinitialiser</button>
    </div>
    <div id="importProgress" style="margin-top:16px;text-align:center;display:none"><div class="spinner"></div> <span id="progressText">Traitement...</span></div>
    ${DB.loaded?`<div style="margin-top:16px;padding:16px;background:rgba(34,197,94,.1);border:1px solid rgba(34,197,94,.3);border-radius:8px;text-align:center;font-size:14px;color:var(--green)">✓ ${Object.keys(DB.products).length} produits analysés${DB.importStatus.chifaDCI?` — ${matched} matchés à la base Chifa AI`:''}${DB._mergedProducts&&Object.keys(DB._mergedProducts).length>0?' — '+Object.keys(DB._mergedProducts).length+' doublons fusionnés':''}</div>`:''}`;
  const zone=document.getElementById('dropZone');
  zone.addEventListener('dragover',e=>{e.preventDefault();zone.classList.add('dragover')});
  zone.addEventListener('dragleave',()=>zone.classList.remove('dragover'));
  zone.addEventListener('drop',e=>{e.preventDefault();zone.classList.remove('dragover');handleAllFiles(e.dataTransfer.files)});
}

async function handleAllFiles(fileList){
  const files=Array.from(fileList);if(!files.length)return;
  const prog=document.getElementById('importProgress');const txt=document.getElementById('progressText');
  if(prog)prog.style.display='block';
  const results={rotation:0,monthly:0,nomenclature:0,chifaDCI:0,unknown:0};
  for(let i=0;i<files.length;i++){
    if(txt)txt.textContent=`Fichier ${i+1}/${files.length}: ${files[i].name}`;
    try{
      const {raw,allSheets,sheetNames}=await parseXLSX(files[i]);
      const type=detectAndImport(raw,files[i].name,allSheets,sheetNames);
      results[type]=(results[type]||0)+1;
    }catch(e){console.error('Error:',files[i].name,e)}
  }
  if(prog)prog.style.display='none';
  renderImport(document.getElementById('mainContent'));
}

function runCompute(){
  const prog=document.getElementById('importProgress');if(prog)prog.style.display='block';
  setTimeout(()=>{computeAll();if(prog)prog.style.display='none';updateBadges();renderImport(document.getElementById('mainContent'))},100);
}
function clearAll(){if(!confirm('Supprimer toutes les données ?'))return;DB.rotation=[];DB.monthly={};DB.nomenclature=[];DB.nationalDCI=[];DB.nationalDCI_all=[];DB.retraits=[];DB._withdrawnBrands=new Set();DB.products={};DB.suppliers={};DB.dciGroups={};DB._brandIndex={};DB._byCode={};DB._dciDosageIndex={};DB._dciGroups={};DB._categoryGroups={};DB._mergedProducts={};DB.uniqueDCINames=[];DB.importStatus={rotation:false,monthly:0,nomenclature:false,chifaDCI:false,retraits:0};DB.loaded=false;localStorage.clear();updateBadges();renderImport(document.getElementById('mainContent'));}
function updateBadges(){if(!DB.loaded)return;const ps=Object.values(DB.products);const a=ps.filter(p=>['rupture','5j'].includes(p.alertLevel)).length;const e=ps.filter(p=>p.expiredQty>0||p.nearExpiryQty>0).length;const ab=document.getElementById('alertBadge'),eb=document.getElementById('expiryBadge'),db=document.getElementById('dciMatchBadge');if(ab){ab.textContent=a;ab.style.display=a>0?'inline':'none'}if(eb){eb.textContent=e;eb.style.display=e>0?'inline':'none'}
// V4: DCI unmatched badge
if(db){const unmatched=ps.filter(p=>p.alertLevel!=='dead'&&!p.dci&&!p.withdrawn).length;db.textContent=unmatched;db.style.display=unmatched>0?'inline':'none'}}

// ==================== DASHBOARD ====================
function renderDashboard(el){
  if(!DB.loaded){el.innerHTML='<p style="padding:40px;text-align:center;color:var(--text3)">Importez les données d\'abord.</p>';return}
  const ps=Object.values(DB.products);const active=ps.filter(p=>p.alertLevel!=='dead'&&p.alertLevel!=='withdrawn');
  const rup=ps.filter(p=>p.alertLevel==='rupture'),a5=ps.filter(p=>p.alertLevel==='5j'),a15=ps.filter(p=>p.alertLevel==='15j'),ok=ps.filter(p=>p.alertLevel==='ok'),sur=ps.filter(p=>p.alertLevel==='surstock'),dead=ps.filter(p=>p.alertLevel==='dead');
  const withdrawn=ps.filter(p=>p.alertLevel==='withdrawn');
  const dciCovered=ps.filter(p=>p.dciGroupCovered).length;
  const budgetUrgent=ps.filter(p=>p.suggestedPurchase>0&&['rupture','5j','15j'].includes(p.alertLevel)&&!p.dciGroupCovered&&!p.withdrawn).reduce((a,p)=>a+p.purchaseCost,0);
  const classA=ps.filter(p=>p.abc==='A');

  el.innerHTML=`
    <h2 class="page-title">Tableau de Bord</h2>
    <p class="page-subtitle">${fmt(active.length)} produits actifs — Stock depuis nomenclature ERP${DB.importStatus.chifaDCI?` — ${dciCovered} produits couverts par génériques`:''}</p>
    <div class="cards">
      <div class="card"><div class="card-label">Produits Actifs</div><div class="card-value">${fmt(active.length)}</div><div class="card-sub">sur ${fmt(ps.length)} total</div></div>
      <div class="card red"><div class="card-label">Ruptures</div><div class="card-value">${fmt(rup.length)}</div></div>
      <div class="card orange"><div class="card-label">Alerte ≤${DB.settings.alert_rupture}j</div><div class="card-value">${fmt(a5.length)}</div></div>
      <div class="card yellow"><div class="card-label">Sécurité ≤${DB.settings.alert_securite}j</div><div class="card-value">${fmt(a15.length)}</div></div>
      <div class="card green"><div class="card-label">Stock OK</div><div class="card-value">${fmt(ok.length)}</div></div>
      <div class="card blue"><div class="card-label">Surstock</div><div class="card-value">${fmt(sur.length)}</div></div>
      <div class="card cyan"><div class="card-label">DCI Couverte</div><div class="card-value">${fmt(dciCovered)}</div><div class="card-sub">pas besoin d'acheter</div></div>
      ${withdrawn.length>0?`<div class="card"><div class="card-label">⛔ Retirés</div><div class="card-value" style="color:var(--text3)">${fmt(withdrawn.length)}</div><div class="card-sub">retirés du marché</div></div>`:''}
      <div class="card purple"><div class="card-label">Budget Urgents</div><div class="card-value" style="font-size:18px">${fmtDA(budgetUrgent)}</div><div class="card-sub">hors DCI & retraits</div></div>
    </div>
    <div class="charts-row">
      <div class="chart-box"><h3>Répartition des Alertes</h3><canvas id="cAlerts"></canvas></div>
      <div class="chart-box"><h3>Ventes Mensuelles</h3><canvas id="cMonthly"></canvas></div>
    </div>
    <div class="charts-row">
      <div class="chart-box"><h3>Classification ABC</h3><canvas id="cABC"></canvas></div>
      <div class="chart-box"><h3>Top 10 — Score de Risque</h3><canvas id="cRisk"></canvas></div>
    </div>`;

  new Chart(document.getElementById('cAlerts'),{type:'doughnut',data:{labels:['Rupture',`≤${DB.settings.alert_rupture}j`,`≤${DB.settings.alert_securite}j`,'OK','Surstock','Inactif',...(withdrawn.length>0?['⛔ Retirés']:[])],datasets:[{data:[rup.length,a5.length,a15.length,ok.length,sur.length,dead.length,...(withdrawn.length>0?[withdrawn.length]:[])],backgroundColor:['#ef4444','#f97316','#eab308','#22c55e','#3b82f6','#475569',...(withdrawn.length>0?['#94a3b8']:[])]}]},options:{responsive:true,plugins:{legend:{position:'bottom',labels:{color:'#94a3b8',font:{size:11}}}}}});

  const sM=Object.keys(DB.monthly).sort();
  new Chart(document.getElementById('cMonthly'),{type:'bar',data:{labels:sM.map(mk=>{const[y,m]=mk.split('-');return['Jan','Fév','Mar','Avr','Mai','Jun','Jul','Aoû','Sep','Oct','Nov','Déc'][parseInt(m)-1]+"'"+y.slice(2)}),datasets:[{label:'Unités',data:sM.map(mk=>DB.monthly[mk].reduce((a,r)=>a+(r.qty_out||0),0)),backgroundColor:'#3b82f6'}]},options:{responsive:true,plugins:{legend:{display:false}},scales:{x:{ticks:{color:'#94a3b8',font:{size:10}}},y:{ticks:{color:'#64748b'},grid:{color:'#1e293b'}}}}});

  const aA=classA.reduce((a,p)=>a+p.yearlyRevenue,0),aB=ps.filter(p=>p.abc==='B').reduce((a,p)=>a+p.yearlyRevenue,0),aC=ps.filter(p=>p.abc==='C').reduce((a,p)=>a+p.yearlyRevenue,0);
  new Chart(document.getElementById('cABC'),{type:'doughnut',data:{labels:[`A: ${classA.length}`,`B: ${ps.filter(p=>p.abc==='B').length}`,`C: ${ps.filter(p=>p.abc==='C').length}`],datasets:[{data:[aA,aB,aC],backgroundColor:['#ef4444','#f97316','#64748b']}]},options:{responsive:true,plugins:{legend:{position:'bottom',labels:{color:'#94a3b8',font:{size:11}}}}}});

  const topR=[...ps].filter(p=>p.alertLevel!=='dead'&&p.alertLevel!=='withdrawn').sort((a,b)=>b.riskScore-a.riskScore).slice(0,10);
  new Chart(document.getElementById('cRisk'),{type:'bar',data:{labels:topR.map(p=>p.name.substring(0,25)),datasets:[{label:'Risque',data:topR.map(p=>p.riskScore),backgroundColor:topR.map(p=>p.riskScore>=70?'#ef4444':p.riskScore>=50?'#f97316':'#eab308')}]},options:{indexAxis:'y',responsive:true,plugins:{legend:{display:false}},scales:{x:{max:100,ticks:{color:'#64748b'},grid:{color:'#1e293b'}},y:{ticks:{color:'#94a3b8',font:{size:10}}}}}});
}

// ==================== ALERTS TABLE (V4: split toolbar/table to fix search bug) ====================
function renderAlerts(el){
  if(!DB.loaded){el.innerHTML='<p style="padding:40px;text-align:center;color:var(--text3)">Importez les données d\'abord.</p>';return}
  el.innerHTML=`
    <h2 class="page-title">Alertes & Gestion de Stock</h2>
    <p class="page-subtitle" id="alertsSubtitle"></p>
    <div class="table-wrap">
      <div class="table-toolbar">
        <input id="alertsSearchInput" placeholder="🔍 Rechercher produit, DCI, labo..." value="${alertsFilter.search}" oninput="alertsFilter.search=this.value;alertsPage=0;updateAlertsTable()">
        <select id="alertsLevelSelect" onchange="alertsFilter.level=this.value;alertsPage=0;updateAlertsTable()">
          <option value="all"${alertsFilter.level==='all'?' selected':''}>Tous niveaux</option>
          <option value="rupture"${alertsFilter.level==='rupture'?' selected':''}>🔴 Rupture</option>
          <option value="5j"${alertsFilter.level==='5j'?' selected':''}>🟠 ≤${DB.settings.alert_rupture}j</option>
          <option value="15j"${alertsFilter.level==='15j'?' selected':''}>🟡 ≤${DB.settings.alert_securite}j</option>
          <option value="ok"${alertsFilter.level==='ok'?' selected':''}>🟢 OK</option>
          <option value="surstock"${alertsFilter.level==='surstock'?' selected':''}>🔵 Surstock</option>
          <option value="withdrawn"${alertsFilter.level==='withdrawn'?' selected':''}>⛔ Retirés</option>
        </select>
        <select id="alertsAbcSelect" onchange="alertsFilter.abc=this.value;alertsPage=0;updateAlertsTable()">
          <option value="all">ABC</option><option value="A"${alertsFilter.abc==='A'?' selected':''}>A</option><option value="B"${alertsFilter.abc==='B'?' selected':''}>B</option><option value="C"${alertsFilter.abc==='C'?' selected':''}>C</option>
        </select>
      </div>
      <div class="table-scroll"><table>
        <thead><tr>
          ${['riskScore','name','abc','effectiveStock','dailyConsumption','daysRemaining','alertLevel','suggestedPurchase','purchaseCost'].map(c=>`<th onclick="toggleSort('${c}')">${{riskScore:'Risque',name:'Produit',abc:'ABC',effectiveStock:'Stock',dailyConsumption:'Conso/j',daysRemaining:'Jours',alertLevel:'Alerte',suggestedPurchase:'Qté Sugg.',purchaseCost:'Coût'}[c]}${sortCol===c?(sortDir===1?' ▲':' ▼'):''}</th>`).join('')}
          <th>DCI Groupe</th><th>Tendance</th>
        </tr></thead>
        <tbody id="alertsTableBody"></tbody>
      </table></div>
      <div id="alertsPagination"></div>
    </div>`;
  updateAlertsTable();
}
// V4: Only updates table body + pagination, toolbar stays intact (no focus loss)
function updateAlertsTable(){
  let ps=Object.values(DB.products).filter(p=>p.alertLevel!=='dead');
  if(alertsFilter.search){const q=alertsFilter.search.toUpperCase();ps=ps.filter(p=>p.name.includes(q)||(p.dci&&p.dci.includes(q))||(p.labo&&p.labo.includes(q)))}
  if(alertsFilter.level!=='all')ps=ps.filter(p=>p.alertLevel===alertsFilter.level);
  if(alertsFilter.abc!=='all')ps=ps.filter(p=>p.abc===alertsFilter.abc);
  if(sortCol)ps.sort((a,b)=>{let va=a[sortCol],vb=b[sortCol];return typeof va==='string'?sortDir*va.localeCompare(vb):sortDir*((va||0)-(vb||0))});
  else ps.sort((a,b)=>b.riskScore-a.riskScore);
  const tp=Math.max(1,Math.ceil(ps.length/ROWS));alertsPage=Math.min(alertsPage,tp-1);if(alertsPage<0)alertsPage=0;
  const page=ps.slice(alertsPage*ROWS,(alertsPage+1)*ROWS);
  const sub=document.getElementById('alertsSubtitle');if(sub)sub.textContent=fmt(ps.length)+' produits — triés par score de risque';
  const tbody=document.getElementById('alertsTableBody');
  if(tbody)tbody.innerHTML=page.map(p=>`<tr onclick="showDetail('${escAttr(p.name)}')" style="cursor:pointer${p.withdrawn?';opacity:.5;text-decoration:line-through':''}">
          <td><div class="risk-bar"><div class="risk-fill" style="width:${p.riskScore}%;background:${p.riskScore>=70?'#ef4444':p.riskScore>=50?'#f97316':p.riskScore>=30?'#eab308':'#22c55e'}"></div></div>${p.riskScore}</td>
          <td title="${p.name}${p.withdrawn?' ⛔ RETIRÉ DU MARCHÉ':''}">${p.withdrawn?'⛔ ':''}${p.name.substring(0,33)}${p.name.length>33?'..':''}</td>
          <td><span class="abc-badge abc-${p.abc} xyz-${p.xyz}">${p.abc}${p.xyz}</span></td>
          <td>${fmt(p.effectiveStock)}${p.expiredQty>0?' <span style="color:var(--red);font-size:10px">(-'+p.expiredQty+')</span>':''}</td>
          <td>${p.dailyConsumption>0?p.dailyConsumption.toFixed(1):'-'}</td>
          <td style="color:${p.daysRemaining<=5?'var(--red)':p.daysRemaining<=15?'var(--orange)':'var(--text)'}">${p.daysRemaining>9e3?'∞':Math.round(p.daysRemaining)+'j'}</td>
          <td><span class="alert-badge alert-${p.alertLevel}">${p.alertLabel}</span></td>
          <td style="font-weight:${p.suggestedPurchase>0?'600':'400'}">${p.dciGroupCovered?'<span class="dci-group-badge dci-covered">DCI ✓</span>':p.suggestedPurchase>0?fmt(p.suggestedPurchase):'-'}</td>
          <td>${p.dciGroupCovered?'-':p.purchaseCost>0?fmtDA(p.purchaseCost):'-'}</td>
          <td>${p.dci?`<span class="dci-group-badge ${p.dciGroupCovered?'dci-covered':p.dciGroupDays&&p.dciGroupDays<30?'dci-partial':'dci-alone'}" title="${p.dci} ${p.matchedDosage||''}">${p.dciGroupCount||1} gén. ${p.matchedDosage||''}${p.dciGroupDays!=null&&p.dciGroupDays<9e3?' '+Math.round(p.dciGroupDays)+'j':''}</span>`:'-'}</td>
          <td style="color:${p.trend>1.1?'var(--green)':p.trend<0.9?'var(--red)':'var(--text2)'}">${p.trend>1.1?'↑':p.trend<0.9?'↓':'→'} ${((p.trend-1)*100).toFixed(0)}%</td>
        </tr>`).join('');
  const pag=document.getElementById('alertsPagination');
  if(pag)pag.innerHTML=tp>1?`<div class="pagination"><button ${alertsPage===0?'disabled':''} onclick="alertsPage=0;updateAlertsTable()">«</button><button ${alertsPage===0?'disabled':''} onclick="alertsPage--;updateAlertsTable()">‹</button><span class="page-info">Page ${alertsPage+1}/${tp} (${fmt(ps.length)})</span><button ${alertsPage>=tp-1?'disabled':''} onclick="alertsPage++;updateAlertsTable()">›</button><button ${alertsPage>=tp-1?'disabled':''} onclick="alertsPage=${tp-1};updateAlertsTable()">»</button></div>`:'';
}
function toggleSort(c){if(sortCol===c)sortDir*=-1;else{sortCol=c;sortDir=c==='name'?1:-1}updateAlertsTable()}

// ==================== PRODUCT DETAIL MODAL ====================
function showDetail(name){
  const p=DB.products[name];if(!p)return;
  document.getElementById('modalTitle').textContent=p.name;
  const sM=Object.keys(DB.monthly).sort();
  const mLabels=sM.map(mk=>{const[y,m]=mk.split('-');return['Jan','Fév','Mar','Avr','Mai','Jun','Jul','Aoû','Sep','Oct','Nov','Déc'][parseInt(m)-1]+"'"+y.slice(2)});
  const mExits=sM.map(mk=>p.monthlyExits[mk]||0),mEntries=sM.map(mk=>p.monthlyEntries[mk]||0);

  // Supplier comparison with dates
  let supHTML='<p style="color:var(--text3);font-size:13px">Aucun fournisseur</p>';
  if(p._supSummaries&&p._supSummaries.length>0){
    const now=new Date();const staleMs=DB.settings.prix_perime_mois*30*864e5;
    supHTML=p._supSummaries.map((s,i)=>{
      const isStale=s.latestDate&&(now-s.latestDate)>staleMs;
      const dateStr=s.latestDate?s.latestDate.toLocaleDateString('fr-FR'):'N/A';
      return`<div class="supplier-row ${i===0?'best':i===1?'second':''}">
        <span class="supplier-name">${s.name}${i===0?' ✅ Meilleur':i===1?' 🥈 2ème':''}</span>
        <span class="supplier-price ${isStale?'price-old':i===0?'price-best':i===1?'price-second':''}">${fmtDA(s.latestPrice)}</span>
        <span class="supplier-date ${isStale?'price-old':''}">${dateStr}${isStale?' ⚠':''}  </span>
        <span style="font-size:11px;color:var(--text3)">×${s.entries}</span>
      </div>`;
    }).join('');
  }

  // V3: DCI interchangeability — strict by DCI + dosage
  let dciHTML='';
  if(p.dci&&p.matchedDosage&&DB._dciGroups){
    const gKey=(p.dci+'|'+p.matchedDosage).toUpperCase();
    const group=DB._dciGroups[gKey];
    if(group){
      // Products in our inventory with same DCI+dosage
      dciHTML=`<h4 style="margin-top:16px;font-size:13px;color:var(--text2)">Génériques en Stock: ${p.dci} ${p.matchedDosage} (${group.products.length} produits en inventaire, couverture: ${group.groupDays>9e3?'∞':Math.round(group.groupDays)+'j'})</h4>
      ${p.dciGroupCovered?'<div style="padding:8px 12px;background:var(--cyan-bg);border:1px solid rgba(6,182,212,.3);border-radius:6px;margin:8px 0;font-size:12px;color:var(--cyan)">✓ DCI+dosage suffisamment couverte — pas besoin de réapprovisionner</div>':''}
      <table style="margin-top:8px"><thead><tr><th>Produit (en stock)</th><th>Stock</th><th>Conso/j</th><th>Jours</th></tr></thead><tbody>
      ${group.products.sort((a,b)=>b.effectiveStock-a.effectiveStock).map(s=>`<tr style="${s.name===p.name?'font-weight:600;background:rgba(59,130,246,.05)':''}"><td>${s.name.substring(0,45)}</td><td>${fmt(s.effectiveStock)}</td><td>${s.dailyConsumption.toFixed(1)}</td><td>${s.daysRemaining>9e3?'∞':Math.round(s.daysRemaining)+'j'}</td></tr>`).join('')}
      </tbody></table>`;
      // V3: Show ALL generics from national DB (including those not in our inventory)
      const allGenerics=getGenericsForDCI(p.dci,p.matchedDosage);
      if(allGenerics.length>0){
        const ourBrands=new Set(group.products.map(gp=>gp.matchedBrand));
        const missing=allGenerics.filter(g=>!ourBrands.has(g.brand));
        if(missing.length>0){
          dciHTML+=`<h4 style="margin-top:12px;font-size:13px;color:var(--orange)">Génériques disponibles à commander (${missing.length} sur ${allGenerics.length} dans la base nationale):</h4>
          <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px">${missing.map(g=>`<span style="padding:4px 8px;background:var(--orange-bg);border-radius:4px;font-size:11px;color:var(--orange)">${g.brand} <span style="color:var(--text3)">(${g.labo||'?'})</span></span>`).join('')}</div>`;
        }
      }
    }
  }else if(p.dci&&p.dciCoverage&&p.dciCoverage.count>1){
    dciHTML=`<h4 style="margin-top:16px;font-size:13px;color:var(--text2)">Même DCI: ${p.dci} (${p.dciCoverage.count} produits — non matchés dans la base nationale)</h4>`;
  }

  document.getElementById('modalContent').innerHTML=`
    ${p.withdrawn?'<div style="padding:10px 16px;background:rgba(100,116,139,.15);border:1px solid rgba(100,116,139,.3);border-radius:6px;margin-bottom:12px;font-size:13px;color:#94a3b8"><strong>⛔ PRODUIT RETIRÉ DU MARCHÉ</strong> — Ce médicament a été retiré. Ne pas commander. Écouler le stock restant ou le retourner.</div>':''}
    <div class="detail-grid">
      <div class="detail-stat"><div class="label">Stock Effectif</div><div class="value">${fmt(p.effectiveStock)}</div></div>
      <div class="detail-stat"><div class="label">Conso/jour</div><div class="value">${p.dailyConsumption.toFixed(1)}</div></div>
      <div class="detail-stat"><div class="label">Jours Restants</div><div class="value" style="color:${p.daysRemaining<=5?'var(--red)':p.daysRemaining<=15?'var(--orange)':'var(--green)'}">${p.daysRemaining>9e3?'∞':Math.round(p.daysRemaining)+'j'}</div></div>
      <div class="detail-stat"><div class="label">Stock Cible 3m</div><div class="value">${fmt(p.targetStock)}</div></div>
      <div class="detail-stat"><div class="label">Qté à Commander</div><div class="value" style="color:var(--accent)">${p.withdrawn?'<span style="color:#94a3b8">⛔ Retiré</span>':p.dciGroupCovered?'<span style="color:var(--cyan)">DCI ✓</span>':fmt(p.suggestedPurchase)}</div></div>
      <div class="detail-stat"><div class="label">Classification</div><div class="value"><span class="abc-badge abc-${p.abc} xyz-${p.xyz}" style="font-size:14px;padding:3px 8px">${p.abc}${p.xyz}</span></div></div>
      <div class="detail-stat"><div class="label">Tendance</div><div class="value" style="color:${p.trend>1.1?'var(--green)':p.trend<0.9?'var(--red)':'var(--text2)'}">${p.trend>1.1?'↑':p.trend<0.9?'↓':'→'} ${((p.trend-1)*100).toFixed(0)}%</div></div>
      <div class="detail-stat"><div class="label">Risque</div><div class="value">${p.riskScore}/100</div></div>
    </div>
    <div style="margin-top:16px"><h4 style="font-size:13px;color:var(--text2);margin-bottom:8px">Mouvements Mensuels</h4><canvas id="modalChart" height="100"></canvas></div>
    <div style="margin-top:16px"><h4 style="font-size:13px;color:var(--text2);margin-bottom:8px">Fournisseurs & Prix (du + récent au + ancien)</h4>${supHTML}</div>
    ${dciHTML}
    ${p.expiredQty>0||p.nearExpiryQty>0?`<div style="margin-top:16px;padding:12px;background:var(--red-bg);border:1px solid rgba(239,68,68,.3);border-radius:6px;font-size:13px">⚠️ ${p.expiredQty>0?`<strong>${p.expiredQty} périmées.</strong> `:''}${p.nearExpiryQty>0?`<strong>${p.nearExpiryQty}</strong> expirent dans 3 mois.`:''}</div>`:''}
    <div style="margin-top:12px;font-size:12px;color:var(--text3)">DCI: ${p.dci||'N/A'} | Labo: ${p.labo||'N/A'} | P.Achat: ${fmtDA(p.p_achat)} | P.Vente: ${fmtDA(p.p_vente)} | Marge: ${pct(p.margin)}${p.dciCode?' | Code: '+p.dciCode:''}</div>`;

  document.getElementById('productModal').classList.add('show');
  setTimeout(()=>{const ctx=document.getElementById('modalChart');if(ctx)new Chart(ctx,{type:'bar',data:{labels:mLabels,datasets:[{label:'Sorties',data:mExits,backgroundColor:'#3b82f6'},{label:'Entrées',data:mEntries,backgroundColor:'#22c55e44',borderColor:'#22c55e',borderWidth:1}]},options:{responsive:true,plugins:{legend:{labels:{color:'#94a3b8',font:{size:10}}}},scales:{x:{ticks:{color:'#94a3b8',font:{size:9}}},y:{ticks:{color:'#64748b'},grid:{color:'#1e293b'}}}}})},50);
}
function closeModal(){document.getElementById('productModal').classList.remove('show')}
document.getElementById('productModal').addEventListener('click',e=>{if(e.target===e.currentTarget)closeModal()});

// ==================== SUPPLIERS PAGE ====================
let supFilter={search:''},supTab='overview';
function renderSuppliers(el){
  if(!DB.loaded){el.innerHTML='<p style="padding:40px;text-align:center;color:var(--text3)">Importez les données d\'abord.</p>';return}
  let sups=Object.values(DB.suppliers);
  if(supFilter.search){const q=supFilter.search.toUpperCase();sups=sups.filter(s=>s.name.toUpperCase().includes(q))}
  sups.sort((a,b)=>b.totalSpend-a.totalSpend);

  const multiSup=Object.values(DB.products).filter(p=>p.supplierCount>1).sort((a,b)=>b.yearlyExits-a.yearlyExits);
  const savings=multiSup.reduce((t,p)=>{
    if(!p._supSummaries||p._supSummaries.length<2)return t;
    return t+(p._supSummaries[1].latestPrice-p._supSummaries[0].latestPrice)*(p.yearlyExits/12);
  },0);

  el.innerHTML=`
    <h2 class="page-title">Comparaison Fournisseurs</h2>
    <p class="page-subtitle">${sups.length} fournisseurs — ${multiSup.length} produits multi-fournisseurs</p>
    <div class="cards" style="margin-bottom:20px">
      <div class="card"><div class="card-label">Fournisseurs</div><div class="card-value">${sups.length}</div></div>
      <div class="card green"><div class="card-label">Produits Comparables</div><div class="card-value">${multiSup.length}</div></div>
      <div class="card purple"><div class="card-label">Économie Potentielle/mois</div><div class="card-value" style="font-size:18px">${fmtDA(savings)}</div></div>
    </div>
    <div class="tabs"><div class="tab ${supTab==='overview'?'active':''}" onclick="supTab='overview';renderSuppliers(document.getElementById('mainContent'))">Fournisseurs</div><div class="tab ${supTab==='compare'?'active':''}" onclick="supTab='compare';renderSuppliers(document.getElementById('mainContent'))">Comparaison Prix</div></div>
    ${supTab==='overview'?`<div class="table-wrap"><div class="table-toolbar"><input placeholder="🔍 Rechercher..." value="${supFilter.search}" oninput="supFilter.search=this.value;renderSuppliers(document.getElementById('mainContent'))"></div><div class="table-scroll"><table><thead><tr><th>Fournisseur</th><th>Produits</th><th>Commandes</th><th>Dépense Totale</th></tr></thead><tbody>${sups.map(s=>`<tr><td><strong>${s.name}</strong></td><td>${Object.keys(s.products).length}</td><td>${s.orderCount}</td><td>${fmtDA(s.totalSpend)}</td></tr>`).join('')}</tbody></table></div></div>`
    :`<div class="table-wrap"><div class="table-toolbar"><input placeholder="🔍 Rechercher produit..." oninput="this.dataset.q=this.value;renderSuppliers(document.getElementById('mainContent'))"></div><div class="table-scroll"><table><thead><tr><th>Produit</th><th>Meilleur Prix</th><th>Date</th><th>Fournisseur</th><th>2ème Prix</th><th>Date</th><th>Fournisseur</th><th>Écart</th></tr></thead><tbody>${multiSup.slice(0,200).map(p=>{
      if(!p._supSummaries||p._supSummaries.length<2)return'';
      const b=p._supSummaries[0],s2=p._supSummaries[1];
      const spread=b.latestPrice>0?((s2.latestPrice-b.latestPrice)/b.latestPrice*100).toFixed(0):'?';
      const now=new Date(),staleMs=DB.settings.prix_perime_mois*30*864e5;
      const bStale=b.latestDate&&(now-b.latestDate)>staleMs;
      const sStale=s2.latestDate&&(now-s2.latestDate)>staleMs;
      return`<tr onclick="showDetail('${escAttr(p.name)}')" style="cursor:pointer">
        <td title="${p.name}">${p.name.substring(0,30)}</td>
        <td class="price-best ${bStale?'price-old':''}">${fmtDA(b.latestPrice)}</td>
        <td class="${bStale?'price-old':''}" style="font-size:11px">${b.latestDate?b.latestDate.toLocaleDateString('fr-FR'):'?'}${bStale?' ⚠':''}</td>
        <td style="font-size:12px">${b.name}</td>
        <td class="price-second ${sStale?'price-old':''}">${fmtDA(s2.latestPrice)}</td>
        <td class="${sStale?'price-old':''}" style="font-size:11px">${s2.latestDate?s2.latestDate.toLocaleDateString('fr-FR'):'?'}${sStale?' ⚠':''}</td>
        <td style="font-size:12px">${s2.name}</td>
        <td style="color:${parseInt(spread)>20?'var(--red)':parseInt(spread)>10?'var(--orange)':'var(--text2)'}">+${spread}%</td>
      </tr>`;
    }).join('')}</tbody></table></div></div>`}`;
}

// ==================== V3: PURCHASE LIST ====================
let purchaseMode='product',purchaseFilter='urgent';
function renderPurchase(el){
  if(!DB.loaded){el.innerHTML='<p style="padding:40px;text-align:center;color:var(--text3)">Importez les données d\'abord.</p>';return}
  // V3: Only show products WITHOUT available generics covering them
  let ps=Object.values(DB.products).filter(p=>p.suggestedPurchase>0&&p.alertLevel!=='dead'&&!p.withdrawn&&!p.dciGroupCovered);
  if(purchaseFilter==='urgent')ps=ps.filter(p=>['rupture','5j','15j'].includes(p.alertLevel));
  else if(purchaseFilter==='rupture')ps=ps.filter(p=>['rupture','5j'].includes(p.alertLevel));
  ps.sort((a,b)=>b.riskScore-a.riskScore);
  const total=ps.reduce((a,p)=>a+p.purchaseCost,0);
  const hiddenCount=Object.values(DB.products).filter(p=>p.dciGroupCovered&&p.suggestedPurchase>0).length;
  // V3: Count products where ALL DCI generics are out of stock
  const noStockDCI=ps.filter(p=>p.dci&&p.dciGroupStock<=0&&p.allDCIGenerics&&p.allDCIGenerics.length>0);

  el.innerHTML=`
    <h2 class="page-title">Liste d'Achat</h2>
    <p class="page-subtitle">Stock cible ${DB.settings.stock_cible} jours${hiddenCount>0?` — ${hiddenCount} produits masqués (DCI couverte par génériques)`:''}</p>
    <div class="export-bar">
      <div class="export-summary">${fmt(ps.length)} produits — <strong>${fmtDA(total)}</strong>${noStockDCI.length>0?` | <span style="color:var(--orange)">${noStockDCI.length} DCI sans stock → voir génériques</span>`:''}</div>
      <div>
        <select onchange="purchaseFilter=this.value;renderPurchase(document.getElementById('mainContent'))">
          <option value="rupture"${purchaseFilter==='rupture'?' selected':''}>Ruptures + ≤${DB.settings.alert_rupture}j</option>
          <option value="urgent"${purchaseFilter==='urgent'?' selected':''}>Tous urgents (≤${DB.settings.alert_securite}j)</option>
          <option value="all"${purchaseFilter==='all'?' selected':''}>Tout vers stock cible</option>
        </select>
        <button class="btn btn-primary" onclick="exportPurchase()" style="margin-left:8px">📥 Exporter Excel</button>
      </div>
    </div>
    <div class="tabs">
      <div class="tab ${purchaseMode==='product'?'active':''}" onclick="purchaseMode='product';renderPurchase(document.getElementById('mainContent'))">Par Produit</div>
      <div class="tab ${purchaseMode==='supplier'?'active':''}" onclick="purchaseMode='supplier';renderPurchase(document.getElementById('mainContent'))">Par Fournisseur</div>
    </div>
    ${purchaseMode==='product'?`<div class="table-wrap"><div class="table-scroll"><table>
      <thead><tr><th>Risque</th><th>Produit</th><th>DCI</th><th>Dosage</th><th>ABC</th><th>Stock</th><th>Jours</th><th>Alerte</th><th>Qté Sugg.</th><th>Coût</th><th>Fournisseur</th><th>Génériques Dispo</th></tr></thead>
      <tbody>${ps.map(p=>{
        const bDate=p.bestPriceDate?p.bestPriceDate.toLocaleDateString('fr-FR'):'';
        // V3: Generic suggestions — all generics from national DB for this DCI+dose
        const genCount=p.allDCIGenerics?p.allDCIGenerics.length:0;
        const hasNoStock=p.dci&&(p.dciGroupStock||0)<=0;
        let genHTML='-';
        if(genCount>0&&hasNoStock){
          // ALL generics for this DCI+dose are out of stock — suggest alternatives to buy
          genHTML=`<span class="alert-badge alert-5j" style="cursor:pointer" onclick="event.stopPropagation();showGenericSuggestions('${escAttr(p.name)}')" title="Cliquer pour voir les génériques">⚠ ${genCount} génériques</span>`;
        }else if(genCount>1&&!p.dciGroupCovered){
          genHTML=`<span style="color:var(--cyan);cursor:pointer;font-size:11px" onclick="event.stopPropagation();showGenericSuggestions('${escAttr(p.name)}')">${genCount} dans base nat.</span>`;
        }
        return`<tr onclick="showDetail('${escAttr(p.name)}')" style="cursor:pointer${hasNoStock?' ;background:rgba(249,115,22,.05)':''}">
          <td>${p.riskScore}</td>
          <td title="${p.name}${p._mergedNames&&p._mergedNames.length>1?' (fusionné: '+p._mergedNames.join(', ')+')':''}">${p.name.substring(0,28)}${p._mergedNames&&p._mergedNames.length>1?' <span style="color:var(--cyan);font-size:10px">×'+p._mergedNames.length+'</span>':''}</td>
          <td style="font-size:11px;color:var(--text3)">${p.dci||'-'}</td>
          <td style="font-size:11px">${p.matchedDosage||extractDosage(p.name)||'-'}</td>
          <td><span class="abc-badge abc-${p.abc}">${p.abc}</span></td>
          <td style="font-weight:600;color:${p.effectiveStock<=0?'var(--red)':'var(--text)'}">${fmt(p.effectiveStock)}</td>
          <td style="color:${p.daysRemaining<=5?'var(--red)':p.daysRemaining<=15?'var(--orange)':'var(--text2)'}">${Math.round(p.daysRemaining)}j</td>
          <td><span class="alert-badge alert-${p.alertLevel}">${p.alertLabel}</span></td>
          <td style="font-weight:600">${fmt(p.suggestedPurchase)}</td>
          <td style="font-weight:600">${fmtDA(p.purchaseCost)}</td>
          <td style="font-size:12px">${p.bestSupplier||'-'}${bDate?' <span style="font-size:10px;color:var(--text3)">'+bDate+'</span>':''}</td>
          <td>${genHTML}</td>
        </tr>`}).join('')}</tbody></table></div></div>`
    :renderBySupplier(ps)}`;
}

// V3: Show popup with all available generics for a DCI+dosage
function showGenericSuggestions(productName){
  const p=DB.products[productName];if(!p||!p.allDCIGenerics)return;
  const generics=p.allDCIGenerics;
  const ourBrands=new Set();
  // Find which brands we already have in stock
  if(DB._dciGroups){
    const gKey=(p.dci+'|'+p.matchedDosage).toUpperCase();
    const group=DB._dciGroups[gKey];
    if(group)group.products.forEach(gp=>ourBrands.add(gp.matchedBrand));
  }
  document.getElementById('modalTitle').textContent=`Génériques: ${p.dci} ${p.matchedDosage||''}`;
  document.getElementById('modalContent').innerHTML=`
    <div style="margin-bottom:12px;font-size:13px;color:var(--text2)">
      ${generics.length} génériques enregistrés dans la base nationale pour <strong>${p.dci} ${p.matchedDosage||''}</strong> (${p.matchedForm||''})
    </div>
    <table><thead><tr><th>Marque</th><th>Laboratoire</th><th>Type</th><th>En Stock ?</th></tr></thead>
    <tbody>${generics.map(g=>{
      const inStock=ourBrands.has(g.brand);
      // V3: Check if this generic is withdrawn
      const isWithdrawn=DB._withdrawnBrands&&(DB._withdrawnBrands.has(g.brand)||DB._withdrawnBrands.has(g.brand+'|'+normalizeDosage(g.dosage)));
      return`<tr style="${isWithdrawn?'opacity:.4;text-decoration:line-through':inStock?'background:rgba(59,130,246,.05)':''}">
        <td><strong>${g.brand}</strong>${isWithdrawn?' ⛔':''}</td>
        <td style="font-size:12px">${g.labo||'-'}</td>
        <td style="font-size:11px">${g.type||'-'}</td>
        <td>${isWithdrawn?'<span style="color:#94a3b8">⛔ Retiré</span>':inStock?'<span style="color:var(--green)">✓ En stock</span>':'<span style="color:var(--orange)">✗ À commander</span>'}</td>
      </tr>`}).join('')}</tbody></table>
    <div style="margin-top:12px;font-size:12px;color:var(--text3)">
      Produit d'origine: ${p.name} | Stock actuel: ${fmt(p.effectiveStock)} | Conso/jour: ${p.dailyConsumption.toFixed(1)}
    </div>`;
  document.getElementById('productModal').classList.add('show');
}

function renderBySupplier(ps){
  const groups={};
  ps.forEach(p=>{const s=p.bestSupplier||'Sans fournisseur';if(!groups[s])groups[s]={products:[],total:0};groups[s].products.push(p);groups[s].total+=p.purchaseCost});
  return Object.entries(groups).sort((a,b)=>b[1].total-a[1].total).map(([sup,d])=>`
    <div class="table-wrap" style="margin-bottom:16px">
      <div style="padding:12px 16px;display:flex;justify-content:space-between;border-bottom:1px solid var(--bg3)"><strong>${sup}</strong> — ${d.products.length} produits<span style="font-weight:600;color:var(--accent)">${fmtDA(d.total)}</span></div>
      <table><thead><tr><th>Produit</th><th>DCI</th><th>Stock</th><th>Qté</th><th>P.Achat</th><th>Date</th><th>Total</th></tr></thead><tbody>
      ${d.products.map(p=>`<tr><td>${p.name.substring(0,30)}</td><td style="font-size:11px;color:var(--text3)">${p.dci||'-'}</td><td style="font-weight:600;color:${p.effectiveStock<=0?'var(--red)':'var(--text)'}">${fmt(p.effectiveStock)}</td><td>${fmt(p.suggestedPurchase)}</td><td>${fmtDA(p.bestPrice<Infinity?p.bestPrice:p.p_achat)}</td><td style="font-size:11px">${p.bestPriceDate?p.bestPriceDate.toLocaleDateString('fr-FR'):''}</td><td>${fmtDA(p.purchaseCost)}</td></tr>`).join('')}
      </tbody></table></div>`).join('');
}

function exportPurchase(){
  let ps=Object.values(DB.products).filter(p=>p.suggestedPurchase>0&&p.alertLevel!=='dead'&&!p.withdrawn&&!p.dciGroupCovered);
  if(purchaseFilter==='urgent')ps=ps.filter(p=>['rupture','5j','15j'].includes(p.alertLevel));
  else if(purchaseFilter==='rupture')ps=ps.filter(p=>['rupture','5j'].includes(p.alertLevel));
  ps.sort((a,b)=>b.riskScore-a.riskScore);
  // V3: Added DCI, Dosage, Stock columns + Génériques Disponibles
  const d=[['Produit','DCI','Dosage','ABC','Stock Actuel','Jours','Alerte','Risque','Qté à Commander','Meilleur Prix','Date Prix','Coût','Fournisseur','2ème Prix','2ème Fournisseur','Tendance','Génériques Disponibles']];
  ps.forEach(p=>{
    const genList=p.allDCIGenerics&&p.allDCIGenerics.length>0?p.allDCIGenerics.map(g=>g.brand+' ('+g.labo+')').join(', '):'';
    d.push([p.name,p.dci||'',p.matchedDosage||extractDosage(p.name)||'',p.abc+p.xyz,p.effectiveStock,Math.round(p.daysRemaining),p.alertLabel,p.riskScore,p.suggestedPurchase,p.bestPrice<Infinity?p.bestPrice:p.p_achat,p.bestPriceDate?p.bestPriceDate.toLocaleDateString('fr-FR'):'',p.purchaseCost,p.bestSupplier||'',p.secondBestPrice<Infinity?p.secondBestPrice:'',p.secondBestSupplier||'',((p.trend-1)*100).toFixed(0)+'%',genList]);
  });
  const wb=XLSX.utils.book_new();const ws=XLSX.utils.aoa_to_sheet(d);
  ws['!cols']=[{wch:40},{wch:20},{wch:12},{wch:5},{wch:10},{wch:8},{wch:10},{wch:6},{wch:10},{wch:12},{wch:12},{wch:14},{wch:22},{wch:12},{wch:22},{wch:8},{wch:50}];
  XLSX.utils.book_append_sheet(wb,ws,'Liste Achat');
  // Sheets per supplier
  const groups={};ps.forEach(p=>{const s=p.bestSupplier||'N-A';if(!groups[s])groups[s]=[];groups[s].push(p)});
  Object.entries(groups).forEach(([sup,prods])=>{
    const sn=sup.substring(0,31).replace(/[\\\/\*\?\[\]]/g,'');
    const sd=[['Produit','DCI','Stock','Qté','P.Achat','Date','Total']];
    prods.forEach(p=>sd.push([p.name,p.dci||'',p.effectiveStock,p.suggestedPurchase,p.bestPrice<Infinity?p.bestPrice:p.p_achat,p.bestPriceDate?p.bestPriceDate.toLocaleDateString('fr-FR'):'',p.purchaseCost]));
    sd.push(['','','','','','TOTAL:',prods.reduce((a,p)=>a+p.purchaseCost,0)]);
    const ws2=XLSX.utils.aoa_to_sheet(sd);ws2['!cols']=[{wch:40},{wch:20},{wch:10},{wch:8},{wch:12},{wch:12},{wch:14}];
    XLSX.utils.book_append_sheet(wb,ws2,sn);
  });
  XLSX.writeFile(wb,`LeghribPharmacy_Achats_${new Date().toISOString().slice(0,10)}.xlsx`);
}

// ==================== EXPIRY PAGE ====================
let expiryTab='expired';
function renderExpiry(el){
  if(!DB.loaded){el.innerHTML='<p style="padding:40px;text-align:center;color:var(--text3)">Importez les données d\'abord.</p>';return}
  const expired=Object.values(DB.products).filter(p=>p.expiredQty>0);
  const near=Object.values(DB.products).filter(p=>p.nearExpiryQty>0);
  const dead=Object.values(DB.products).filter(p=>p.yearlyExits===0&&p.stock>0&&p.alertLevel==='dead');
  const expVal=expired.reduce((a,p)=>a+p.expiredQty*p.p_achat,0);
  const nearVal=near.reduce((a,p)=>a+p.nearExpiryQty*p.p_achat,0);

  el.innerHTML=`
    <h2 class="page-title">Péremption & Stock Mort</h2>
    <div class="cards">
      <div class="card red"><div class="card-label">Périmés</div><div class="card-value">${expired.length}</div><div class="card-sub">${fmtDA(expVal)}</div></div>
      <div class="card orange"><div class="card-label">Exp. ≤3 mois</div><div class="card-value">${near.length}</div><div class="card-sub">${fmtDA(nearVal)}</div></div>
      <div class="card blue"><div class="card-label">Stock Mort</div><div class="card-value">${dead.length}</div></div>
    </div>
    <div class="tabs">
      <div class="tab ${expiryTab==='expired'?'active':''}" onclick="expiryTab='expired';renderExpiry(document.getElementById('mainContent'))">Périmés (${expired.length})</div>
      <div class="tab ${expiryTab==='near'?'active':''}" onclick="expiryTab='near';renderExpiry(document.getElementById('mainContent'))">Bientôt (${near.length})</div>
      <div class="tab ${expiryTab==='dead'?'active':''}" onclick="expiryTab='dead';renderExpiry(document.getElementById('mainContent'))">Mort (${dead.length})</div>
    </div>
    <div class="table-wrap"><div class="table-scroll"><table><thead><tr>
      ${expiryTab==='expired'?'<th>Produit</th><th>Qté Périmée</th><th>Valeur</th><th>Stock Total</th>'
       :expiryTab==='near'?'<th>Produit</th><th>Qté Exp. 3m</th><th>Valeur</th><th>Conso/mois</th><th>Mois pr écouler</th><th>Action</th>'
       :'<th>Produit</th><th>Stock</th><th>Valeur</th>'}
    </tr></thead><tbody>
      ${(expiryTab==='expired'?expired.sort((a,b)=>b.expiredQty*b.p_achat-a.expiredQty*a.p_achat):expiryTab==='near'?near.sort((a,b)=>b.nearExpiryQty*b.p_achat-a.nearExpiryQty*a.p_achat):dead.sort((a,b)=>b.stock*b.p_achat-a.stock*a.p_achat)).map(p=>{
        if(expiryTab==='expired')return`<tr><td>${p.name.substring(0,40)}</td><td style="color:var(--red);font-weight:600">${fmt(p.expiredQty)}</td><td>${fmtDA(p.expiredQty*p.p_achat)}</td><td>${fmt(p.stock)}</td></tr>`;
        if(expiryTab==='near'){const m=p.avgMonthlyExits>0?(p.nearExpiryQty/p.avgMonthlyExits).toFixed(1):'∞';const bad=m==='∞'||parseFloat(m)>3;return`<tr><td>${p.name.substring(0,40)}</td><td style="color:var(--orange);font-weight:600">${fmt(p.nearExpiryQty)}</td><td>${fmtDA(p.nearExpiryQty*p.p_achat)}</td><td>${p.avgMonthlyExits.toFixed(1)}</td><td style="color:${bad?'var(--red)':'var(--green)'}">${m}</td><td style="font-size:11px">${bad?'<span style="color:var(--red)">⚠ Ne pas réappro.</span>':'<span style="color:var(--green)">✓ Écoulement OK</span>'}</td></tr>`}
        return`<tr><td>${p.name.substring(0,40)}</td><td>${fmt(p.stock)}</td><td>${fmtDA(p.stock*p.p_achat)}</td></tr>`;
      }).join('')}
    </tbody></table></div></div>`;
}

// ==================== V4: DCI MATCHING PAGE ====================
let dciFilter='all',dciSearch='';
// V4.1: Predefined cosmétique/article categories
const CATEGORIES_PREDEF=['Crème','Shampooing','Écran Solaire','Dentifrice','Lait Corporel','Déodorant','Maquillage','Complément Alimentaire','Hygiène Bébé','Accessoire','Autre'];

// V4.1: Generic dropdown functions
function filterDropdown(inputId,dropdownId,list,value){
  const dd=document.getElementById(dropdownId);if(!dd)return;
  const q=(value||'').trim().toUpperCase();
  let matches=q.length<1?list.slice(0,15):list.filter(n=>n.toUpperCase().includes(q)).slice(0,15);
  if(matches.length===0){dd.style.display='none';return;}
  dd.innerHTML=matches.map(n=>`<div class="dci-dropdown-item" onmousedown="selectDropdownItem('${inputId}','${dropdownId}','${escAttr(n)}')">${n}</div>`).join('');
  dd.style.display='block';
}
function selectDropdownItem(inputId,dropdownId,val){
  const inp=document.getElementById(inputId);if(inp){inp.value=val;inp.dispatchEvent(new Event('change'));}
  closeDropdown(dropdownId);
}
function closeDropdown(dropdownId){const dd=document.getElementById(dropdownId);if(dd)dd.style.display='none';}

function renderDCIMatch(el){
  if(!DB.loaded){el.innerHTML='<p style="padding:40px;text-align:center;color:var(--text3)">Importez les données d\'abord.</p>';return}
  const ps=Object.values(DB.products).filter(p=>p.alertLevel!=='dead'&&!p.withdrawn);
  const matched=ps.filter(p=>p.dci&&!p.manualDCI);
  const unmatched=ps.filter(p=>!p.dci&&!p.manualCategory);
  const corrected=ps.filter(p=>p.manualDCI);
  const articles=ps.filter(p=>!p.dci&&p.category!=='medicament');
  const categorized=ps.filter(p=>p.manualCategory);
  el.innerHTML=`
    <h2 class="page-title">Matching DCI & Catégories</h2>
    <p class="page-subtitle">Attribuez les DCI (médicaments) et catégories (articles/cosmétiques)</p>
    <div class="cards">
      <div class="card green"><div class="card-label">Matchés Auto</div><div class="card-value">${matched.length}</div></div>
      <div class="card red"><div class="card-label">Non Matchés</div><div class="card-value">${unmatched.length}</div></div>
      <div class="card purple"><div class="card-label">Corrigés</div><div class="card-value">${corrected.length}</div></div>
      <div class="card cyan"><div class="card-label">Articles Catégorisés</div><div class="card-value">${categorized.length}</div></div>
    </div>
    <div class="tabs">
      <div class="tab ${dciFilter==='all'?'active':''}" onclick="dciFilter='all';renderDCIMatch(document.getElementById('mainContent'))">Tous (${ps.length})</div>
      <div class="tab ${dciFilter==='unmatched'?'active':''}" onclick="dciFilter='unmatched';renderDCIMatch(document.getElementById('mainContent'))">Non matchés ✗ (${unmatched.length})</div>
      <div class="tab ${dciFilter==='corrected'?'active':''}" onclick="dciFilter='corrected';renderDCIMatch(document.getElementById('mainContent'))">Corrigés ✎ (${corrected.length})</div>
      <div class="tab ${dciFilter==='articles'?'active':''}" onclick="dciFilter='articles';renderDCIMatch(document.getElementById('mainContent'))">Articles ✦ (${articles.length})</div>
    </div>
    <div class="table-wrap">
      <div class="table-toolbar">
        <input id="dciSearchInput" placeholder="🔍 Rechercher produit, DCI, catégorie..." value="${dciSearch}" oninput="dciSearch=this.value;updateDCITable()">
      </div>
      <div class="table-scroll" style="max-height:calc(100vh - 420px)"><table>
        <thead><tr><th>Produit</th><th>DCI Auto</th><th>Dosage</th><th>Confiance</th><th>Correction DCI / Catégorie</th><th>Dosage (opt.)</th><th>Action</th></tr></thead>
        <tbody id="dciTableBody"></tbody>
      </table></div>
    </div>`;
  updateDCITable();
}
function updateDCITable(){
  let ps=Object.values(DB.products).filter(p=>p.alertLevel!=='dead'&&!p.withdrawn);
  if(dciFilter==='unmatched')ps=ps.filter(p=>!p.dci&&!p.manualCategory);
  else if(dciFilter==='corrected')ps=ps.filter(p=>p.manualDCI);
  else if(dciFilter==='articles')ps=ps.filter(p=>!p.dci&&p.category!=='medicament');
  if(dciSearch){const q=dciSearch.toUpperCase();ps=ps.filter(p=>p.name.includes(q)||(p.dci&&p.dci.includes(q))||(p.manualCategory&&p.manualCategory.toUpperCase().includes(q)))}
  ps.sort((a,b)=>(!a.dci&&!a.manualCategory?-1:!b.dci&&!b.manualCategory?1:0)||(b.riskScore-a.riskScore));
  const tbody=document.getElementById('dciTableBody');if(!tbody)return;
  const allCats=[...new Set([...CATEGORIES_PREDEF,...(DB.manualCategories||[])])].sort();
  tbody.innerHTML=ps.slice(0,200).map(p=>{
    const key=btoa(encodeURIComponent(p.name)).replace(/=/g,'');
    const corr=DB.manualDCI[p.name]||{};
    const isArticle=!p.dci&&p.category!=='medicament'&&!corr.dci;
    const conf=p.manualCategory?'<span class="dci-confidence dci-manual">✦ Catégorie</span>':p.manualDCI?'<span class="dci-confidence dci-manual">✎ Manuel</span>':p.dci?'<span class="dci-confidence dci-exact">✓ Auto</span>':'<span class="dci-confidence dci-none">✗ Aucun</span>';
    // Dropdown: DCI for medicines, Category for articles
    const ddId='dd_'+key;
    const inpId='dci_'+key;
    let ddField;
    if(isArticle||corr.category){
      ddField=`<div class="dci-autocomplete"><input id="${inpId}" value="${corr.category||''}" placeholder="Catégorie..." class="dci-input" autocomplete="off"
        oninput="filterDropdown('${inpId}','${ddId}',${JSON.stringify(allCats).replace(/"/g,'&quot;')},this.value)"
        onfocus="filterDropdown('${inpId}','${ddId}',${JSON.stringify(allCats).replace(/"/g,'&quot;')},this.value)"
        onblur="setTimeout(()=>closeDropdown('${ddId}'),200)">
        <div id="${ddId}" class="dci-dropdown"></div></div>`;
    } else {
      const dciList='DB.uniqueDCINames';
      ddField=`<div class="dci-autocomplete"><input id="${inpId}" value="${corr.dci||''}" placeholder="${p.dci||'DCI...'}" class="dci-input" autocomplete="off"
        oninput="filterDropdown('${inpId}','${ddId}',${dciList},this.value)"
        onfocus="filterDropdown('${inpId}','${ddId}',${dciList},this.value)"
        onblur="setTimeout(()=>closeDropdown('${ddId}'),200)">
        <div id="${ddId}" class="dci-dropdown"></div></div>`;
    }
    return`<tr>
      <td title="${p.name}">${p.name.substring(0,35)}</td>
      <td style="font-size:11px">${p.dci||p.manualCategory?'<span class="cat-badge">'+p.manualCategory+'</span>':'<span style="color:var(--red)">—</span>'}</td>
      <td style="font-size:11px">${p.matchedDosage||extractDosage(p.name)||'-'}</td>
      <td>${conf}</td>
      <td>${ddField}</td>
      <td><input id="dos_${key}" value="${corr.dosage||''}" placeholder="${p.matchedDosage||extractDosage(p.name)||'opt.'}" style="background:var(--bg);border:1px solid var(--bg3);color:var(--text);padding:3px 6px;border-radius:4px;font-size:11px;width:80px"></td>
      <td><button class="btn btn-primary" style="padding:3px 8px;font-size:11px" onclick="saveDCICorrection('${escAttr(p.name)}')">💾</button>${corr.dci||corr.category?` <button class="btn btn-secondary" style="padding:3px 8px;font-size:11px" onclick="deleteDCICorrection('${escAttr(p.name)}')">✗</button>`:''}</td>
    </tr>`}).join('');
}
function saveDCICorrection(name){
  const key=btoa(encodeURIComponent(name)).replace(/=/g,'');
  const dciVal=(document.getElementById('dci_'+key)||{}).value;
  const dosage=(document.getElementById('dos_'+key)||{}).value;
  if(!dciVal&&!dosage)return;
  DB.manualDCI[name]={};
  const valUp=san(dciVal);
  // Determine if it's a category or a DCI
  const allCats=[...CATEGORIES_PREDEF,...(DB.manualCategories||[])];
  const isCategory=allCats.some(c=>c.toUpperCase()===valUp);
  if(isCategory){
    DB.manualDCI[name].category=dciVal.trim();
  } else if(dciVal){
    // Check if it's a known DCI from dropdown or free text
    DB.manualDCI[name].dci=valUp;
    // If it's not in the known list and looks like a new category, still store as DCI
  }
  if(dosage)DB.manualDCI[name].dosage=san(dosage);
  localStorage.setItem('leghrib_pharmacy_dci_corrections',JSON.stringify(DB.manualDCI));
  const p=DB.products[name];
  if(p){
    if(isCategory){p.manualCategory=dciVal.trim();p.category='parapharm';}
    else if(dciVal){p.dci=valUp;p.category='medicament';}
    if(dosage)p.matchedDosage=normalizeDosage(san(dosage));
    p.manualDCI=true;
  }
  updateDCITable();
}
function deleteDCICorrection(name){
  delete DB.manualDCI[name];
  localStorage.setItem('leghrib_pharmacy_dci_corrections',JSON.stringify(DB.manualDCI));
  computeAll();updateBadges();
  renderDCIMatch(document.getElementById('mainContent'));
}

// ==================== SETTINGS ====================
function renderSettings(el){
  const s=DB.settings;
  el.innerHTML=`
    <h2 class="page-title">Paramètres</h2>
    <div class="settings-grid">
      <div class="setting-group"><h3>🔔 Seuils d'Alerte (jours)</h3>
        ${[['alert_rupture','Alerte rupture'],['alert_securite','Stock sécurité'],['stock_cible','Stock cible'],['surstock','Seuil surstock'],['prix_perime_mois','Prix périmé (mois)']].map(([k,l])=>`<div class="setting-row"><label>${l}</label><input type="number" value="${s[k]}" onchange="DB.settings['${k}']=Number(this.value);localStorage.setItem('leghrib_pharmacy_settings',JSON.stringify(DB.settings))"></div>`).join('')}
      </div>
      <div class="setting-group"><h3>📈 Objectifs Croissance (%)</h3>
        <div class="setting-row"><label>Global</label><input type="number" value="${s.growth_global}" onchange="DB.settings.growth_global=Number(this.value);localStorage.setItem('leghrib_pharmacy_settings',JSON.stringify(DB.settings))">%</div>
        ${['medicament','parapharm','dispositif','autre'].map(c=>`<div class="setting-row"><label>${{medicament:'Médicaments',parapharm:'Parapharmacie',dispositif:'Dispositifs',autre:'Autre'}[c]}</label><input type="number" value="${s.growth_categories[c]}" onchange="DB.settings.growth_categories['${c}']=Number(this.value);localStorage.setItem('leghrib_pharmacy_settings',JSON.stringify(DB.settings))">%</div>`).join('')}
      </div>
      <div class="setting-group"><h3>📦 Stock Cible par Classification (mois)</h3>
        <p style="font-size:11px;color:var(--text3);margin-bottom:12px">Nombre de mois de stock cible selon ABC/XYZ. A=forte valeur, C=faible. X=stable, Z=erratique.</p>
        ${['AX','AY','AZ','BX','BY','BZ','CX','CY','CZ'].map(k=>`<div class="setting-row"><label>${k}</label><input type="number" step="0.5" min="0.5" max="6" value="${s.targetMonths?s.targetMonths[k]:{AX:3,AY:2.5,AZ:2,BX:2.5,BY:2,BZ:1.5,CX:2,CY:1.5,CZ:1}[k]}" onchange="if(!DB.settings.targetMonths)DB.settings.targetMonths={AX:3,AY:2.5,AZ:2,BX:2.5,BY:2,BZ:1.5,CX:2,CY:1.5,CZ:1};DB.settings.targetMonths['${k}']=Number(this.value);localStorage.setItem('leghrib_pharmacy_settings',JSON.stringify(DB.settings))"> mois</div>`).join('')}
      </div>
      <div class="setting-group"><h3>🔄 Actions</h3>
        <div style="display:flex;gap:12px;flex-wrap:wrap">
          <button class="btn btn-primary" onclick="runCompute();showPage('dashboard')">🔄 Recalculer</button>
          <button class="btn btn-secondary" onclick="exportReport()">📊 Rapport Complet</button>
          <button class="btn btn-secondary" onclick="clearAll()">🗑️ Réinitialiser</button>
        </div>
      </div>
    </div>`;
}

function exportReport(){
  if(!DB.loaded)return;
  const ps=Object.values(DB.products).filter(p=>p.alertLevel!=='dead').sort((a,b)=>b.riskScore-a.riskScore);
  // V3: Added Dosage, Noms Fusionnés, Génériques Dispo columns
  const d=[['Produit','DCI','Dosage','Labo','Code DCI','ABC/XYZ','Stock','Périmé','Exp.3m','Conso/j','Jours','Alerte','Risque','Cible','Qté Sugg.','DCI Couverte','Noms Fusionnés','P.Achat','P.Vente','Marge%','Coût','Meilleur Fourn.','Prix','Date','2ème Fourn.','2ème Prix','Tendance','Génériques Disponibles']];
  ps.forEach(p=>{
    const mergedNames=p._mergedNames&&p._mergedNames.length>1?p._mergedNames.join(' | '):'';
    const genList=p.allDCIGenerics&&p.allDCIGenerics.length>0?p.allDCIGenerics.map(g=>g.brand).join(', '):'';
    d.push([p.name,p.dci||'',p.matchedDosage||'',p.labo||'',p.dciCode||'',p.abc+p.xyz,p.effectiveStock,p.expiredQty,p.nearExpiryQty,+p.dailyConsumption.toFixed(2),Math.round(p.daysRemaining),p.alertLabel,p.riskScore,p.targetStock,p.suggestedPurchase,p.dciGroupCovered?'OUI':'NON',mergedNames,p.p_achat,p.p_vente,+(p.margin*100).toFixed(1),p.purchaseCost,p.bestSupplier||'',p.bestPrice<Infinity?p.bestPrice:'',p.bestPriceDate?p.bestPriceDate.toLocaleDateString('fr-FR'):'',p.secondBestSupplier||'',p.secondBestPrice<Infinity?p.secondBestPrice:'',((p.trend-1)*100).toFixed(0)+'%',genList]);
  });
  const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(d),'Rapport');
  XLSX.writeFile(wb,`LeghribPharmacy_Rapport_${new Date().toISOString().slice(0,10)}.xlsx`);
}

// ==================== INIT ====================
try{const s=localStorage.getItem('leghrib_pharmacy_settings');if(s){const parsed=JSON.parse(s);Object.assign(DB.settings,parsed);if(parsed.targetMonths)DB.settings.targetMonths={...{AX:3,AY:2.5,AZ:2,BX:2.5,BY:2,BZ:1.5,CX:2,CY:1.5,CZ:1},...parsed.targetMonths};}}catch(e){}
try{const mc=localStorage.getItem('leghrib_pharmacy_dci_corrections');if(mc)DB.manualDCI=JSON.parse(mc)}catch(e){}
try{const cats=localStorage.getItem('leghrib_pharmacy_categories');if(cats)DB.manualCategories=JSON.parse(cats)}catch(e){}
showPage('import');
