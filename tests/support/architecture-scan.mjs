// Conservative source-level guard, not a proof of arbitrary JavaScript behavior.
// SQL migrations are outside this code scan; runtime permissions are tested by A02.
const driver=/^(?:pg(?:\/|$)|postgres(?:\/|$)|@neondatabase\/serverless(?:\/|$)|@prisma\/client(?:\/|$)|drizzle-orm(?:\/|$)|better-sqlite3(?:\/|$))/;
const writes=/\b(?:INSERT\s+INTO|UPDATE\s+[\w".]+\s+SET|DELETE\s+FROM|TRUNCATE\s+(?:TABLE\s+)?|MERGE\s+INTO|ALTER\s+TABLE|DROP\s+TABLE|CREATE\s+TABLE)\b/i;
export function scanWriteBoundaries(files){
 const failures=[];
 for(const [path,source] of Object.entries(files)){
  if(path.startsWith('src/server/api/'))continue;
  if(writes.test(source))failures.push({path,rule:'write-outside-service'});
  for(const match of source.matchAll(/(?:\bfrom\s*|\brequire\s*\(\s*|\bimport\s*\(\s*|\bimport\s*)['"]([^'"]+)['"]/g)){
   if(driver.test(match[1]))failures.push({path,rule:'database-driver-outside-service',module:match[1]});
  }
 }
 return failures;
}
