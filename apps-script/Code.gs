/**
 * Saiga survey: Google Sheet-д өгөгдөл хүлээн авах Apps Script.
 *
 * Суулгах:
 * 1. Sheet-ээ нээгээд Extensions > Apps Script.
 * 2. Code.gs доторх бүгдийг устгаад энэ файлыг бүтнээр нь хуулж тавина. Save.
 * 3. Deploy > New deployment > Type: Web app.
 *    Execute as: Me. Who has access: Anyone. Deploy.
 * 4. Google зөвшөөрөл асууна: Authorize > (Advanced > Go to ... ) > Allow.
 * 5. Гарсан /exec холбоосыг аппын Тохиргоо > Google Sheet хэсэгт тавина.
 *
 * Зургууд таны Google Drive дээр "Saiga survey зураг" хавтсанд хадгалагдана.
 */

var PHOTO_ROOT = 'Saiga survey зураг';

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var req = JSON.parse(e.postData.contents);
    var out;
    if (req.action === 'ping') out = { ok: true, sheet: SpreadsheetApp.getActive().getName() };
    else if (req.action === 'upsert') out = upsert(req);
    else if (req.action === 'photo') out = photo(req);
    else out = { ok: false, error: 'unknown action' };
    return json(out);
  } catch (err) {
    return json({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

function doGet() {
  return json({ ok: true, app: 'Saiga survey' });
}

function json(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

// Мөрүүдийг id-аар нь шинэчилнэ, байхгүй бол нэмнэ.
function upsert(req) {
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(req.sheet) || ss.insertSheet(req.sheet);
  var headers = req.headers;
  var lastCol = sh.getLastColumn();
  var cur = lastCol ? sh.getRange(1, 1, 1, lastCol).getValues()[0].map(String) : [];
  if (!cur.filter(String).length) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sh.setFrozenRows(1);
    cur = headers.slice();
  } else {
    // Шинэ багана нэмэгдсэн бол төгсгөлд нь нэмнэ
    headers.forEach(function (h) {
      if (cur.indexOf(h) < 0) { cur.push(h); sh.getRange(1, cur.length).setValue(h).setFontWeight('bold'); }
    });
  }
  var keyCol = cur.indexOf(req.key);
  var lastRow = sh.getLastRow();
  var ids = lastRow > 1 ? sh.getRange(2, keyCol + 1, lastRow - 1, 1).getValues().map(function (r) { return String(r[0]); }) : [];
  var appended = [];
  req.rows.forEach(function (row) {
    var vals = cur.map(function (h) { return row[h] === undefined || row[h] === null ? '' : row[h]; });
    var i = ids.indexOf(String(row[req.key]));
    if (i >= 0) sh.getRange(i + 2, 1, 1, vals.length).setValues([vals]);
    else { appended.push(vals); ids.push(String(row[req.key])); }
  });
  if (appended.length) sh.getRange(sh.getLastRow() + 1, 1, appended.length, cur.length).setValues(appended);
  return { ok: true, updated: req.rows.length - appended.length, added: appended.length };
}

function folder(parent, name) {
  var it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

// Зургийг Drive-д хадгалж холбоосыг буцаана. Ижил нэртэй байвал дахин үүсгэхгүй.
function photo(req) {
  var dir = folder(folder(DriveApp.getRootFolder(), PHOTO_ROOT), req.folder || 'Бусад');
  var ex = dir.getFilesByName(req.name);
  var file = ex.hasNext() ? ex.next() : dir.createFile(Utilities.newBlob(Utilities.base64Decode(req.data), req.mime || 'image/jpeg', req.name));
  if (req.caption) file.setDescription(req.caption);
  return { ok: true, url: file.getUrl() };
}
