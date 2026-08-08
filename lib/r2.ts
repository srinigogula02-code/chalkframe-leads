import "server-only";
import { DeleteObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

function required(name:string){const value=process.env[name]?.trim();if(!value)throw new Error(`R2 is not configured: set ${name}`);return value}
type R2Config = ReturnType<typeof config>;
let cached: { config: R2Config; client: S3Client } | undefined;

function config(){return {accountId:required("CLOUDFLARE_ACCOUNT_ID"),accessKeyId:required("R2_ACCESS_KEY_ID"),secretAccessKey:required("R2_SECRET_ACCESS_KEY"),bucket:required("R2_BUCKET_NAME"),publicUrl:required("R2_PUBLIC_URL").replace(/\/$/,"")}}
function connection() {
  if (cached) return cached;
  const value = config();
  cached = {
    config: value,
    client: new S3Client({region:"auto",endpoint:`https://${value.accountId}.r2.cloudflarestorage.com`,credentials:{accessKeyId:value.accessKeyId,secretAccessKey:value.secretAccessKey}}),
  };
  return cached;
}

export async function uploadLeadImage(input:{key:string;bytes:Uint8Array;contentType:string;cacheControl?:string}){const { config: value, client }=connection();await client.send(new PutObjectCommand({Bucket:value.bucket,Key:input.key,Body:input.bytes,ContentType:input.contentType,CacheControl:input.cacheControl||"public, max-age=31536000, immutable"}));return `${value.publicUrl}/${input.key.split("/").map(encodeURIComponent).join("/")}`}

function ownedObjectKey(url:string, publicUrl:string){
  try{
    const candidate=new URL(url);
    const base=new URL(`${publicUrl.replace(/\/$/,"")}/`);
    const basePath=base.pathname.endsWith("/")?base.pathname:`${base.pathname}/`;
    if(candidate.origin!==base.origin||!candidate.pathname.startsWith(basePath))return null;
    const encodedKey=candidate.pathname.slice(basePath.length);
    if(!encodedKey)return null;
    const segments=encodedKey.split("/").map(segment=>decodeURIComponent(segment));
    if(segments.some(segment=>!segment||segment==="."||segment===".."))return null;
    return segments.join("/");
  }catch{return null}
}

export async function deleteLeadImage(url:string){
  const {config:value,client}=connection();
  const key=ownedObjectKey(url,value.publicUrl);
  if(!key)return false;
  await client.send(new DeleteObjectCommand({Bucket:value.bucket,Key:key}));
  return true;
}
