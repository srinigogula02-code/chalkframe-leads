import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { compressImage } from "@/lib/compress-image";
import { uploadLeadImage } from "@/lib/r2";

export const runtime = "nodejs";
const MAX_BYTES=4*1024*1024;
const TYPES:Record<string,(bytes:Uint8Array)=>boolean>={
  "image/png":b=>b[0]===0x89&&b[1]===0x50&&b[2]===0x4e&&b[3]===0x47,
  "image/jpeg":b=>b[0]===0xff&&b[1]===0xd8&&b[2]===0xff,
  "image/gif":b=>["GIF87a","GIF89a"].includes(String.fromCharCode(...b.slice(0,6))),
  "image/webp":b=>String.fromCharCode(...b.slice(0,4))==="RIFF"&&String.fromCharCode(...b.slice(8,12))==="WEBP",
};
export async function POST(req:Request){const user=await getSession();if(!user||user.role!=="admin")return NextResponse.json({error:"Unauthorized"},{status:401});let form:FormData;try{form=await req.formData()}catch{return NextResponse.json({error:"Expected an image upload."},{status:400})}const file=form.get("file");if(!(file instanceof File))return NextResponse.json({error:"Paste or choose an image."},{status:400});const signature=TYPES[file.type];if(!signature)return NextResponse.json({error:"Use PNG, JPEG, GIF, or WebP."},{status:415});if(file.size===0||file.size>MAX_BYTES)return NextResponse.json({error:"Image must be smaller than 4 MB."},{status:413});const bytes=new Uint8Array(await file.arrayBuffer());if(!signature(bytes))return NextResponse.json({error:"The file contents do not match its image type."},{status:415});try{const optimized=await compressImage(bytes,file.type);const now=new Date();const key=`leads/${now.getUTCFullYear()}/${String(now.getUTCMonth()+1).padStart(2,"0")}/${randomUUID()}.${optimized.extension}`;const url=await uploadLeadImage({key,bytes:optimized.bytes,contentType:optimized.contentType});return NextResponse.json({url,originalSize:optimized.originalBytes,optimizedSize:optimized.bytes.byteLength,savedPercent:Math.max(0,Math.round((1-optimized.bytes.byteLength/optimized.originalBytes)*100)),width:optimized.width,height:optimized.height})}catch(error){console.error("R2 lead image upload failed",error);return NextResponse.json({error:error instanceof Error?error.message:"Image upload failed."},{status:502})}}
