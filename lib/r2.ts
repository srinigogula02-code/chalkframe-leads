import "server-only";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

function required(name:string){const value=process.env[name]?.trim();if(!value)throw new Error(`R2 is not configured: set ${name}`);return value}
function config(){return {accountId:required("CLOUDFLARE_ACCOUNT_ID"),accessKeyId:required("R2_ACCESS_KEY_ID"),secretAccessKey:required("R2_SECRET_ACCESS_KEY"),bucket:required("R2_BUCKET_NAME"),publicUrl:required("R2_PUBLIC_URL").replace(/\/$/,"")}}
export async function uploadLeadImage(input:{key:string;bytes:Uint8Array;contentType:string}){const value=config();const client=new S3Client({region:"auto",endpoint:`https://${value.accountId}.r2.cloudflarestorage.com`,credentials:{accessKeyId:value.accessKeyId,secretAccessKey:value.secretAccessKey}});await client.send(new PutObjectCommand({Bucket:value.bucket,Key:input.key,Body:input.bytes,ContentType:input.contentType,CacheControl:"public, max-age=31536000, immutable"}));return `${value.publicUrl}/${input.key.split("/").map(encodeURIComponent).join("/")}`}
