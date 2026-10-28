import { apiErrorMessages } from "@tavern/shared";
import { RoleImportError } from "./error.js";
import type { RoleWorldbookEntry } from "@tavern/shared";
// Translate the reviewed card's EJS delimiters during migration; the server receives a normal controller module.
export function compileMvuController(
  entries: RoleWorldbookEntry[],
  controllerEntryIds: number[],
) {
  const functions = controllerEntryIds.map((id) => {
    const entry = entries.find((e) => (e.uid ?? e.id) === id);
    if (!entry)
      throw new RoleImportError("ROLE_IMPORT_ENTRY_MISSING", { entryId: id });
    let cursor = 0,
      body = "";
    for (const match of entry.content.matchAll(
      /<%([_=-]?)([\s\S]*?)[_-]?%>/g,
    )) {
      body += `text += ${JSON.stringify(entry.content.slice(cursor, match.index))};\n`;
      body +=
        match[1] === "=" || match[1] === "-"
          ? `text += (${match[2]});\n`
          : match[2] + "\n";
      cursor = match.index + match[0].length;
    }
    body += `text += ${JSON.stringify(entry.content.slice(cursor))};\n`;
    return `${JSON.stringify(id)}: async (getvar,setvar,getwi,toastr)=>{let text='';\n${body}\nreturn text;}`;
  });
  return `const controllers={${functions.join(",\n")}};
export async function renderController({entryId,variables,characterBook}) {
 const referencedEntryIds=[]; const writes=[];
 const getvar=(path,options={})=>path.split('.').slice(1).reduce((value,key)=>value?.[key],variables) ?? options.defaults;
 const setvar=(path,value)=>{writes.push('{{setvar::'+path+'::'+String(value)+'}}');};
 const getwi=async (_,name)=>{const entry=characterBook.entries.find(e=>e.comment===name);if(!entry)throw Error(${JSON.stringify(apiErrorMessages.ROLE_IMPORT_CONTROLLER_ENTRY_MISSING)}+': '+name);referencedEntryIds.push(entry.id);return entry.content;};
 const toastr={success(){},info(){}};
 const text=await controllers[entryId](getvar,setvar,getwi,toastr);
 return {text:writes.join('')+text,referencedEntryIds};
}`;
}
