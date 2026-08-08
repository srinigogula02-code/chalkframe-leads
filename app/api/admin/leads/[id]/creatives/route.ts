import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { sql } from "@/lib/db";
import { deleteLeadImage } from "@/lib/r2";

const uuidPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function DELETE(req:Request,{params}:{params:Promise<{id:string}>}){
  const user=await getSession();
  if(!user||user.role!=="admin")return NextResponse.json({error:"Unauthorized"},{status:401});

  const {id}=await params;
  let body:unknown;
  try{body=await req.json()}catch{return NextResponse.json({error:"Choose at least one creative to delete."},{status:400})}
  const rawIds=(body&&typeof body==="object"&&Array.isArray((body as {imageIds?:unknown}).imageIds))?(body as {imageIds:unknown[]}).imageIds:[];
  const imageIds=[...new Set(rawIds.map(value=>String(value)).filter(Boolean))].slice(0,30);
  if(!imageIds.length)return NextResponse.json({error:"Choose at least one creative to delete."},{status:400});
  if(imageIds.some(imageId=>!uuidPattern.test(imageId)))return NextResponse.json({error:"One selected creative has an invalid identifier. Refresh and try again."},{status:400});

  const [leadRows,imageRows]=await Promise.all([
    sql`SELECT id FROM leads WHERE id=${id} LIMIT 1`,
    sql`SELECT id,url FROM lead_images WHERE lead_id=${id} AND id=ANY(${imageIds}::uuid[])`,
  ]);
  if(!leadRows[0])return NextResponse.json({error:"Business not found."},{status:404});
  if(imageRows.length!==imageIds.length)return NextResponse.json({error:"One or more creatives no longer belong to this business. Refresh and try again."},{status:409});

  try{
    await Promise.all(imageRows.map(image=>deleteLeadImage(String(image.url))));
  }catch(error){
    console.error("Could not delete selected creative from R2",error);
    return NextResponse.json({error:"The creative files could not be removed from storage. Nothing was deleted from the business."},{status:502});
  }

  const result=await sql`WITH deleted AS (
    DELETE FROM lead_images WHERE lead_id=${id} AND id=ANY(${imageIds}::uuid[]) RETURNING id
  ), remaining AS (
    SELECT COUNT(*)::integer AS count FROM lead_images WHERE lead_id=${id} AND NOT (id=ANY(${imageIds}::uuid[]))
  ), updated AS (
    UPDATE leads SET
      collage_original_image_id=CASE WHEN collage_original_image_id=ANY(${imageIds}::uuid[]) THEN NULL ELSE collage_original_image_id END,
      workflow_status=CASE WHEN (SELECT count FROM remaining)=0 AND workflow_status='research_completed' THEN 'research_pending' ELSE workflow_status END,
      updated_at=now()
    WHERE id=${id}
    RETURNING workflow_status,collage_original_image_id
  )
  SELECT (SELECT COUNT(*)::integer FROM deleted) AS deleted_count,(SELECT count FROM remaining) AS remaining_count,updated.workflow_status,updated.collage_original_image_id FROM updated`;
  const saved=result[0];
  return NextResponse.json({deleted:Number(saved?.deleted_count||0),remaining:Number(saved?.remaining_count||0),workflowStatus:saved?.workflow_status,collageOriginalImageId:saved?.collage_original_image_id});
}
