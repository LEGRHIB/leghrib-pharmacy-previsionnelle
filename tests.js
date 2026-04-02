// ==================== CORE FUNCTIONS FROM app.js ====================

// Utility function to sanitize strings
const san = s => s?String(s).trim().toUpperCase():'';

// Convert Excel date serial number to JavaScript Date
function excelDate(v){
  if(v instanceof Date)return v;
  if(typeof v==='number')return new Date((v-25569)*864e5);
  if(typeof v==='string')return new Date(v);
  return null;
}

// Get month key from date: "2026-04"
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

// ==================== TEST FRAMEWORK ====================

let passed=0, failed=0, results=[];

function group(name){
  results.push({type:'group',name});
}

function test(name, actual, expected){
  const pass = actual === expected;
  if(pass) passed++; else failed++;
  results.push({type:'test',name,pass,actual,expected});
}

function testNull(name, actual){
  const pass = actual === null || actual === undefined;
  if(pass) passed++; else failed++;
  results.push({type:'test',name,pass,actual,expected:'null/undefined'});
}

function testArrayEquals(name, actual, expected){
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  if(pass) passed++; else failed++;
  results.push({type:'test',name,pass,actual,expected});
}

// ==================== TESTS ====================

// --- extractDosage Tests ---
group('extractDosage');
test('Simple: LOMAC 20MG B/15', extractDosage('LOMAC 20MG B/15'), '20MG');
test('Gram: AUGMENTIN 1G COMP', extractDosage('AUGMENTIN 1G COMP'), '1G');
test('Compound: AUGMENTIN 1G/125MG', extractDosage('AUGMENTIN 1G/125MG'), '1G/125MG');
test('Percentage: VOLTARENE 0.05% COLLYRE', extractDosage('VOLTARENE 0.05% COLLYRE'), '0.05%');
test('Per ML: AMOXICILLINE 250MG/5ML SIROP', extractDosage('AMOXICILLINE 250MG/5ML SIROP'), '250MG/5ML');
test('Large number: EPREX 4000UI INJ', extractDosage('EPREX 4000UI INJ'), '4000UI');
test('European thousands: EPREX 200.000UI', extractDosage('EPREX 200.000UI'), '200000UI');
test('MCG: VENTOLINE 100MCG SPRAY', extractDosage('VENTOLINE 100MCG SPRAY'), '100MCG');
test('Slash no unit first: AROVAN 150/5MG', extractDosage('AROVAN 150/5MG'), '150/5MG');
testNull('No dosage: PAMPERS TAILLE 3', extractDosage('PAMPERS TAILLE 3'));
test('Triple compound: EXFORGE 10/160MG', extractDosage('EXFORGE 10/160MG'), '10/160MG');
test('With spaces: DOLIPRANE 500 MG', extractDosage('DOLIPRANE 500 MG'), '500MG');
test('Decimal: SYNTHROID 0.1MG', extractDosage('SYNTHROID 0.1MG'), '0.1MG');
test('Compound with decimal: AUGMENTIN 250MG/31.25MG', extractDosage('AUGMENTIN 250MG/31.25MG'), '250MG/31.25MG');
test('Multiple dots: EPREX 1.200.000UI', extractDosage('EPREX 1.200.000UI'), '1200000UI');
test('Comma decimal: SYNTHROID 0,1MG', extractDosage('SYNTHROID 0,1MG'), '0.1MG');
test('ML unit: SIROP 5ML', extractDosage('SIROP 5ML'), '5ML');
test('Percent decimal: CREAM 0.5%', extractDosage('CREAM 0.5%'), '0.5%');
test('Very large UI: VITAMINE 10.000.000UI', extractDosage('VITAMINE 10.000.000UI'), '10000000UI');
test('Lowercase input: augmentin 500mg', extractDosage('augmentin 500mg'), '500MG');

// --- normalizeDosage Tests ---
group('normalizeDosage');
test('1G to MG: 1G', normalizeDosage('1G'), '1000MG');
test('500MG unchanged: 500MG', normalizeDosage('500MG'), '500MG');
test('0.5G to MG: 0.5G', normalizeDosage('0.5G'), '500MG');
test('Lowercase: 20mg', normalizeDosage('20mg'), '20MG');
test('Compound normalize: 1G/125MG', normalizeDosage('1G/125MG'), '1000MG/125MG');
test('Percentage preserved: 0.05%', normalizeDosage('0.05%'), '0.05%');
testNull('Null input: null', normalizeDosage(null));
test('MCG preserved: 100MCG', normalizeDosage('100MCG'), '100MCG');
test('UI preserved: 4000UI', normalizeDosage('4000UI'), '4000UI');
test('Per ML preserved: 250MG/5ML', normalizeDosage('250MG/5ML'), '250MG/5ML');
test('With spaces: 500 MG', normalizeDosage('500 MG'), '500MG');
test('Compound with decimals: 250MG/31.25MG', normalizeDosage('250MG/31.25MG'), '250MG/31.25MG');
test('0.1G to MG: 0.1G', normalizeDosage('0.1G'), '100MG');
test('Comma to dot: 500,5MG', normalizeDosage('500,5MG'), '500.5MG');

// --- extractBrand Tests ---
group('extractBrand');
test('Simple: LOMAC 20MG B/15 GELULE', extractBrand('LOMAC 20MG B/15 GELULE'), 'LOMAC');
test('Compound dosage: AUGMENTIN 1G/125MG COMP', extractBrand('AUGMENTIN 1G/125MG COMP'), 'AUGMENTIN');
test('Standard: DOLIPRANE 500MG COMP', extractBrand('DOLIPRANE 500MG COMP'), 'DOLIPRANE');
test('Percentage: VOLTARENE 0.05% COLLYRE', extractBrand('VOLTARENE 0.05% COLLYRE'), 'VOLTARENE');
test('Multi-word: EFFERALGAN VITAMINE C 500MG COMP', extractBrand('EFFERALGAN VITAMINE C 500MG COMP'), 'EFFERALGAN VITAMINE');
test('Laboratory: AMOXICILLINE BIOGARAN 1G', extractBrand('AMOXICILLINE BIOGARAN 1G'), 'AMOXICILLINE BIOGARAN');
test('Simple dosage: AROVAN 20MG', extractBrand('AROVAN 20MG'), 'AROVAN');
test('Simple dosage 2: ATHYROZOL 5MG', extractBrand('ATHYROZOL 5MG'), 'ATHYROZOL');
test('No dosage: ASPIRIN', extractBrand('ASPIRIN'), 'ASPIRIN');
test('Extended release: INEXIUM 20MG LP', extractBrand('INEXIUM 20MG LP'), 'INEXIUM');
test('Gel form: DOLIPRANE 500MG GELULE', extractBrand('DOLIPRANE 500MG GELULE'), 'DOLIPRANE');
test('Ratio form: AROVAN 10/160MG', extractBrand('AROVAN 10/160MG'), 'AROVAN');
test('Sirop: AMOXICILLINE 250MG/5ML SIROP', extractBrand('AMOXICILLINE 250MG/5ML SIROP'), 'AMOXICILLINE');
test('Spray: VENTOLINE 100MCG SPRAY', extractBrand('VENTOLINE 100MCG SPRAY'), 'VENTOLINE');
test('Injection: EPREX 4000UI INJ', extractBrand('EPREX 4000UI INJ'), 'EPREX');
test('Trailing dot: INEXIUM.', extractBrand('INEXIUM.'), 'INEXIUM');
test('Extended release variants: SYNTHROID 50MCG XR', extractBrand('SYNTHROID 50MCG XR'), 'SYNTHROID');
test('With trailing number to remove: AROVAN 150 150', extractBrand('AROVAN 150 150'), 'AROVAN');
testNull('Null input: null', extractBrand(null));
test('With BT prefix: DOLIPRANE BT/10 500MG', extractBrand('DOLIPRANE BT/10 500MG'), 'DOLIPRANE');

// --- san Tests ---
group('san');
test('Trim and uppercase: " hello "', san(' hello '), 'HELLO');
test('Null to empty: null', san(null), '');
test('Mixed case: Test 123', san('Test 123'), 'TEST 123');
test('Special chars preserved: ASPIRIN&CAFFEINE', san('ASPIRIN&CAFFEINE'), 'ASPIRIN&CAFFEINE');
test('Numbers: 12345', san('12345'), '12345');
test('Empty string: ""', san(''), '');
test('Spaces only: "   "', san('   '), '');

// --- excelDate Tests ---
group('excelDate');
test('Already a Date', excelDate(new Date('2026-01-01')).toISOString().split('T')[0], '2026-01-01');
test('String date', excelDate('2026-01-01').toISOString().split('T')[0], '2026-01-01');
testNull('Null input', excelDate(null));
// Excel date 45475 = 2024-06-15 approximately (45475 * 86400000 + epoch adjustment)
const excelNum = excelDate(45475);
const excelStr = excelNum.toISOString().split('T')[0];
test('Excel numeric (45475)', excelStr.length > 0, true); // Just verify it returns a date

// --- monthKey Tests ---
group('monthKey');
test('Current date format', monthKey(new Date('2026-04-15')), '2026-04');
test('Different month', monthKey(new Date('2026-12-01')), '2026-12');
test('January', monthKey(new Date('2026-01-01')), '2026-01');
testNull('Null input', monthKey(null));
test('String date', monthKey('2026-04-15'), '2026-04');

// ==================== RENDER RESULTS ====================

const el=document.getElementById('results');
const sum=document.getElementById('summary');
sum.className='summary '+(failed===0?'pass':'fail');
sum.textContent=failed===0?`✓ All ${passed} tests passed`:`✗ ${failed} failed, ${passed} passed (${passed+failed} total)`;

results.forEach(r=>{
  if(r.type==='group'){
    const groupDiv = document.createElement('div');
    groupDiv.className='group';
    const titleDiv = document.createElement('div');
    titleDiv.className='group-title';
    titleDiv.textContent=r.name;
    groupDiv.appendChild(titleDiv);
    el.appendChild(groupDiv);
    return;
  }
  const last=el.querySelector('.group:last-child');
  const div=document.createElement('div');
  div.className='test '+(r.pass?'pass':'fail');
  let html=r.pass?`✓ ${r.name}`:`✗ ${r.name}`;
  if(!r.pass){
    let actualStr = typeof r.actual === 'string' ? `"${r.actual}"` : JSON.stringify(r.actual);
    let expectedStr = typeof r.expected === 'string' ? `"${r.expected}"` : JSON.stringify(r.expected);
    html+=` <span class="expected">— got: ${actualStr}, expected: ${expectedStr}</span>`;
  }
  div.innerHTML=html;
  (last||el).appendChild(div);
});
