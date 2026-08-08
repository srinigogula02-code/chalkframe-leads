"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, ArrowLeft, ArrowRight, ArrowUpRight, Bot, Check, CheckCircle2, Clock3, Copy, Image as ImageIcon, Images, Mail, Phone, Plus, RefreshCw, Save, Send, Sparkles, StickyNote, Trash2, X } from "lucide-react";
import { WORKFLOW_LABELS, WORKFLOW_STATUSES, type WorkflowStatus } from "@/lib/workflow";
import NavDropdown from "@/app/dashboard/_components/nav-dropdown";
import type { SessionUser } from "@/lib/db";
import type { BusinessImage, BusinessLead } from "./page";

type CollageResponse = { collageOriginalImageId:string|null; redesignImages:BusinessImage[]; collageQueued?:boolean; workflowStatus?:WorkflowStatus; error?:string };
type CreativeDeleteResponse = { deleted?:number; remaining?:number; collageOriginalImageId?:string|null; workflowStatus?:WorkflowStatus; error?:string };

export default function BusinessWorkspace({ user, lead, previousId, nextId, statusFilter }: { user: SessionUser | null; lead:BusinessLead; previousId:string|null; nextId:string|null; statusFilter:WorkflowStatus|"all" }) {
  const router=useRouter();
  const [originals,setOriginals]=useState<BusinessImage[]>(lead.images);
  const soleOriginal=originals.length===1?originals[0].id||null:null;
  const [notes,setNotes]=useState(lead.admin_notes||"");
  const [chatgptUrl,setChatgptUrl]=useState(lead.chatgpt_url||"");
  const [status,setStatus]=useState<WorkflowStatus>(lead.workflow_status);
  const [redesignTarget,setRedesignTarget]=useState<string|null>(null);
  const [fbAdUrl,setFbAdUrl]=useState("");
  const [redesigns,setRedesigns]=useState<BusinessImage[]>(lead.redesign_images.length?lead.redesign_images:[{url:"",description:""}]);
  const [selectedOriginal,setSelectedOriginal]=useState<string|null>(soleOriginal||lead.collage_original_image_id||null);
  const [selectedImage,setSelectedImage]=useState<BusinessImage|null>(null);
  const [copied,setCopied]=useState(false);
  const [saving,setSaving]=useState(false);
  const [uploading,setUploading]=useState(false);
  const [deletingCreatives,setDeletingCreatives]=useState(false);
  const [sendingDraftId,setSendingDraftId]=useState<string|null>(null);
  const [selectedCreativeIds,setSelectedCreativeIds]=useState<string[]>([]);
  const [confirmCreativeDelete,setConfirmCreativeDelete]=useState(false);
  const queueStarted=useRef(false);
  const [confirmDelete,setConfirmDelete]=useState(false);
  const [message,setMessage]=useState("");
  const [error,setError]=useState("");
  const query=statusFilter==="all"?"":`?status=${statusFilter}`;
  const chatGptPrompt="Think like you're the world's best performance marketing ad creators, creator who knows every aspect like user psychology, designing, and all other aspects, so redesign this ad creative considering All the aspects @Create image . And you don't have to put all the information in it if it will looks cluttered. remeber it is for instagram ad creative, too much information will result in cluttered look especially mobile small scrrens";
  const chatGptHref=`https://chatgpt.com/?q=${encodeURIComponent(chatGptPrompt)}`;
  const hasPendingCollage=redesigns.some(image=>image.url&&["queued","processing"].includes(image.collageStatus||""));
  const hasPendingEmail=redesigns.some(image=>["queued","processing"].includes(image.emailDraft?.status||""));
  const hasMissingEmailDraft=redesigns.some(image=>image.collageStatus==="completed"&&image.collageUrl&&!image.emailDraft);
  const selectableCreativeIds=originals.flatMap(image=>image.id?[image.id]:[]);

  const refreshCollages=useCallback(async()=>{try{const response=await fetch(`/api/admin/leads/${lead.id}`,{cache:"no-store"});const body=await response.json() as CollageResponse;if(response.ok){setRedesigns(current=>current.map(image=>{const match=body.redesignImages.find(item=>item.id&&item.id===image.id);return match?{...image,collageUrl:match.collageUrl,collageStatus:match.collageStatus,collageError:match.collageError,emailDraft:match.emailDraft}:image}));setSelectedOriginal(current=>body.collageOriginalImageId||current)}}catch{/* Polling resumes automatically. */}},[lead.id]);
  const queueCollages=useCallback(async(originalId=selectedOriginal,retry=false,silent=false)=>{if(!originalId)return;setError("");if(!silent)setMessage("Queueing the collage…");try{const response=await fetch(`/api/admin/leads/${lead.id}/collages`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({originalImageId:originalId,retry})});const body=await response.json() as CollageResponse;if(!response.ok)throw new Error(body.error||"The collage could not be queued.");setSelectedOriginal(body.collageOriginalImageId);setRedesigns(current=>current.map(image=>image.url&&image.collageStatus!=="completed"?{...image,collageStatus:"queued",collageError:null}:image));setMessage("The collage is being created in the background.");window.setTimeout(()=>void refreshCollages(),1400)}catch(e){setError(e instanceof Error?e.message:"The collage could not be queued.")}finally{queueStarted.current=true}},[lead.id,refreshCollages,selectedOriginal]);

  useEffect(()=>{if(!selectedImage)return;const close=(event:KeyboardEvent)=>{if(event.key==="Escape")setSelectedImage(null)};document.addEventListener("keydown",close);return()=>document.removeEventListener("keydown",close)},[selectedImage]);
  useEffect(()=>{if(!hasPendingCollage&&!hasPendingEmail)return;const refresh=()=>void refreshCollages();const first=window.setTimeout(refresh,1500);const interval=window.setInterval(refresh,3500);return()=>{window.clearTimeout(first);window.clearInterval(interval)}},[hasPendingCollage,hasPendingEmail,refreshCollages]);
  useEffect(()=>{if(!hasMissingEmailDraft)return;const timer=window.setTimeout(()=>void refreshCollages(),0);return()=>window.clearTimeout(timer)},[hasMissingEmailDraft,refreshCollages]);
  useEffect(()=>{const canStart=Boolean(selectedOriginal)&&redesigns.some(image=>image.url&&["waiting","queued"].includes(image.collageStatus||""));if(!canStart||queueStarted.current)return;queueStarted.current=true;void queueCollages(selectedOriginal,false,true)},[queueCollages,redesigns,selectedOriginal]);

  function showImage(image:BusinessImage){setSelectedImage(image);setCopied(false)}
  async function copyDescription(){if(!selectedImage?.description)return;await navigator.clipboard.writeText(selectedImage.description);setCopied(true);window.setTimeout(()=>setCopied(false),1800)}
  async function persist(nextRedesigns=redesigns,success="Business workspace saved.",originalId=selectedOriginal){
    const res=await fetch(`/api/admin/leads/${lead.id}`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({adminNotes:notes,chatgptUrl,workflowStatus:status,redesignImages:nextRedesigns,collageOriginalImageId:originalId})});
    const body=await res.json() as CollageResponse;
    if(!res.ok)throw new Error(body.error||"Changes could not be saved.");
    if(body.workflowStatus)setStatus(body.workflowStatus);
    setSelectedOriginal(body.collageOriginalImageId||null);
    setRedesigns(body.redesignImages.length?body.redesignImages:[{url:"",description:""}]);
    queueStarted.current=Boolean(body.collageQueued);
    setMessage(body.collageQueued?`${success} The collage is being created in the background.`:success);
    return body;
  }
  async function save(){setSaving(true);setError("");setMessage("");try{await persist()}catch(e){setError(e instanceof Error?e.message:"Changes could not be saved.")}finally{setSaving(false)}}
  async function chooseOriginal(image:BusinessImage){if(!image.id||selectedOriginal===image.id)return;setSaving(true);setError("");setMessage("");setSelectedOriginal(image.id);try{await persist(redesigns,"Creative selected for the comparison collage.",image.id)}catch(e){setSelectedOriginal(lead.collage_original_image_id||soleOriginal);setError(e instanceof Error?e.message:"The creative could not be selected.")}finally{setSaving(false)}}
  async function triggerAdRedesign(sourceImageId?:string,sourceImageUrl?:string,redesignAll=false){
    const target=redesignAll?"all":sourceImageId||sourceImageUrl||"fb_url";
    setRedesignTarget(target);
    setError("");
    setMessage(redesignAll?"Queueing AI ad redesigns for all creatives…":"Queueing performance marketing AI ad redesign…");
    try{
      const res=await fetch(`/api/admin/leads/${lead.id}/ad-redesign`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({sourceImageId,sourceImageUrl,redesignAll})});
      const body=await res.json();
      if(!res.ok)throw new Error(body.error||"AI Ad Redesign generation failed.");
      setMessage("AI Ad Redesign queued! Generating image in background…");
      setRedesignTarget(null);

      // Poll workspace updates every 4 seconds for up to 3 minutes
      let attempts=0;
      const pollInterval=window.setInterval(async()=>{
        attempts++;
        await refreshCollages();
        router.refresh();
        if(attempts>=45){
          window.clearInterval(pollInterval);
        }
      },4000);
    }catch(e){
      setMessage("");
      setError(e instanceof Error?e.message:"AI Ad Redesign generation failed.");
      setRedesignTarget(null);
    }
  }
  async function uploadPastedImage(file:File){setUploading(true);setError("");setMessage("Optimizing and uploading pasted image…");try{const form=new FormData();form.set("file",file);const response=await fetch("/api/admin/uploads",{method:"POST",body:form});const result=await response.json();if(!response.ok)throw new Error(result.error||"Image upload failed.");const uploaded={url:String(result.url),description:""};const next=redesigns.length===1&&!redesigns[0].url&&!redesigns[0].description?[uploaded]:[...redesigns,uploaded];setRedesigns(next);await persist(next,`Image compressed ${result.savedPercent}% and saved to this business.`)}catch(e){setMessage("");setError(e instanceof Error?e.message:"Image upload failed.")}finally{setUploading(false)}}
  async function regenerateEmail(image:BusinessImage){if(!image.id)return;setError("");setMessage("Queueing a fresh email draft…");try{const response=await fetch(`/api/admin/leads/${lead.id}/email-drafts`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({redesignImageId:image.id})});const body=await response.json();if(!response.ok)throw new Error(body.error||"The email could not be queued.");setRedesigns(current=>current.map(item=>item.id===image.id?{...item,emailDraft:item.emailDraft?{...item.emailDraft,status:"queued",error:null,reviewReason:null}:{id:`queued-${image.id}`,status:"queued",subject:null,body:null,reviewReason:null,error:null,model:null,costUsd:null,latencyMs:null,recipientEmail:lead.email,updatedAt:new Date().toISOString(),sentAt:null}}:item));setMessage("The email is being drafted in the background.")}catch(e){setMessage("");setError(e instanceof Error?e.message:"The email could not be queued.")}}
  async function sendDraftEmail(image:BusinessImage){
    const draft=image.emailDraft;
    const recipient=draft?.recipientEmail||lead.email;
    if(!image.id||!draft?.subject||!draft.body||!recipient)return;
    setSendingDraftId(draft.id);setError("");setMessage(`Sending email to ${recipient}…`);
    try{
      const response=await fetch(`/api/admin/leads/${lead.id}/send-email`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({recipientEmail:recipient,subject:draft.subject,bodyMarkdown:draft.body,collageUrl:image.collageUrl,redesignImageId:image.id})});
      const body=await response.json();
      if(!response.ok)throw new Error(body.error||"The email could not be sent.");
      const sentAt=String(body.sentAt||new Date().toISOString());
      setRedesigns(current=>current.map(item=>item.id===image.id&&item.emailDraft?{...item,emailDraft:{...item.emailDraft,sentAt}}:item));
      setStatus("contacted");
      setMessage(body.message||`Email sent to ${recipient}. The business is now Contacted.`);
      router.refresh();
    }catch(e){setMessage("");setError(e instanceof Error?e.message:"The email could not be sent.")}finally{setSendingDraftId(null)}
  }
  function handlePaste(event:React.ClipboardEvent){const image=[...event.clipboardData.items].find(item=>item.kind==="file"&&item.type.startsWith("image/"))?.getAsFile();if(!image)return;event.preventDefault();event.stopPropagation();if(!uploading)void uploadPastedImage(image)}
  async function remove(){setSaving(true);setError("");try{const res=await fetch(`/api/admin/leads/${lead.id}`,{method:"DELETE"});const body=await res.json();if(!res.ok)throw new Error(body.error||"Could not delete this business.");router.push("/dashboard");router.refresh()}catch(e){setError(e instanceof Error?e.message:"Could not delete this business.");setConfirmDelete(false);setSaving(false)}}
  function toggleCreativeSelection(imageId:string){setSelectedCreativeIds(current=>current.includes(imageId)?current.filter(id=>id!==imageId):[...current,imageId])}
  async function deleteSelectedCreatives(){
    if(!selectedCreativeIds.length)return;
    setDeletingCreatives(true);setError("");setMessage("");
    try{
      const res=await fetch(`/api/admin/leads/${lead.id}/creatives`,{method:"DELETE",headers:{"content-type":"application/json"},body:JSON.stringify({imageIds:selectedCreativeIds})});
      const body=await res.json() as CreativeDeleteResponse;
      if(!res.ok)throw new Error(body.error||"The selected creatives could not be deleted.");
      const deletedIds=new Set(selectedCreativeIds);
      setOriginals(current=>current.filter(image=>!image.id||!deletedIds.has(image.id)));
      setSelectedImage(current=>current?.id&&deletedIds.has(current.id)?null:current);
      setSelectedCreativeIds([]);
      setSelectedOriginal(body.collageOriginalImageId||null);
      if(body.workflowStatus)setStatus(body.workflowStatus);
      setConfirmCreativeDelete(false);
      setMessage(`${body.deleted||selectedCreativeIds.length} ad creative${(body.deleted||selectedCreativeIds.length)===1?"":"s"} permanently deleted.`);
      router.refresh();
    }catch(e){setError(e instanceof Error?e.message:"The selected creatives could not be deleted.");setConfirmCreativeDelete(false)}finally{setDeletingCreatives(false)}
  }
  async function changeWorkflowStatus(nextStatus:WorkflowStatus){if(nextStatus===status)return;setStatus(nextStatus);setSaving(true);setError("");try{const res=await fetch(`/api/admin/leads/${lead.id}`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({workflowStatus:nextStatus})});const body=await res.json();if(!res.ok)throw new Error(body.error||"Status could not be updated.");setMessage(`Status updated to ${WORKFLOW_LABELS[nextStatus]}.`);if(nextStatus==="redesign_created"){router.push(`/dashboard/redesign-created/${lead.id}`)}else if(nextStatus==="ad_inactive"){router.push("/dashboard?status=ad_inactive")}else{router.push(`/dashboard/leads/${lead.id}?status=${nextStatus}`)}router.refresh()}catch(e){setStatus(lead.workflow_status);setError(e instanceof Error?e.message:"Status could not be updated.")}finally{setSaving(false)}}

  return <main className="business-page">
    <header className="business-topbar"><img src="/brand/chalkframe-logo-dark.svg" alt="Chalkframe"/><nav className="record-nav">{status==="research_completed"&&<a className="chatgpt-launch" href={chatGptHref} target="_blank" rel="noreferrer"><Sparkles size={14}/>Open ChatGPT</a>}<Link aria-disabled={!previousId} className={!previousId?"disabled":""} href={previousId?`/dashboard/leads/${previousId}${query}`:"#"}><ArrowLeft size={16}/><span>Previous</span></Link><span className="technical">Business record</span><Link aria-disabled={!nextId} className={!nextId?"disabled":""} href={nextId?`/dashboard/leads/${nextId}${query}`:"#"}><span>Next</span><ArrowRight size={16}/></Link>{user && <NavDropdown user={user} />}</nav></header>
    <section className="business-hero"><div><h1>{lead.title||"Meta ad business"}</h1><a href={lead.ad_url} target="_blank" rel="noreferrer">Open source ad <ArrowUpRight size={14}/></a></div><label className="status-select">Workflow status<select value={status} disabled={saving} onChange={e=>void changeWorkflowStatus(e.target.value as WorkflowStatus)}>{WORKFLOW_STATUSES.map(item=><option key={item} value={item}>{WORKFLOW_LABELS[item]}</option>)}</select></label></section>
    <section className="workflow-rail">{WORKFLOW_STATUSES.map((item,index)=>{const current=WORKFLOW_STATUSES.indexOf(status);return <div className={index<=current?"reached":""} key={item}><i>{index<current?<Check size={13}/>:index+1}</i><span>{WORKFLOW_LABELS[item]}</span></div>})}</section>
    <div className="business-layout"><div className="business-canvas">
      <section className="business-section creatives-section">
        <div className="section-heading">
          <div><span className="technical">Original research</span><h2>Active ad creatives</h2></div>
          <div className="section-heading-actions">
            {selectableCreativeIds.length>0&&<button type="button" className="select-creatives-btn" onClick={()=>setSelectedCreativeIds(selectedCreativeIds.length===selectableCreativeIds.length?[]:selectableCreativeIds)}>{selectedCreativeIds.length===selectableCreativeIds.length?<><X size={13}/>Clear selection</>:<><Check size={13}/>Select all</>}</button>}
            {selectedCreativeIds.length>0&&<button type="button" className="delete-creatives-btn" onClick={()=>setConfirmCreativeDelete(true)}><Trash2 size={13}/>Delete selected ({selectedCreativeIds.length})</button>}
            {originals.length>1&&<button type="button" className="redesign-all-btn" disabled={Boolean(redesignTarget)} onClick={()=>void triggerAdRedesign(undefined,undefined,true)}><Sparkles size={13}/>{redesignTarget==="all"?"Redesigning All…":"Redesign All Creatives"}</button>}
          </div>
        </div>
        {originals.length?<div className="original-gallery">{originals.map((image,index)=>{const selectedForDelete=Boolean(image.id&&selectedCreativeIds.includes(image.id));return <article className={`${selectedOriginal===image.id?"collage-source ":""}${selectedForDelete?"selected-for-delete":""}`} key={image.id||index}>{image.id&&<button type="button" className={`creative-select-checkbox ${selectedForDelete?"selected":""}`} onClick={()=>toggleCreativeSelection(image.id!)} aria-label={`${selectedForDelete?"Deselect":"Select"} creative ${index+1}`} aria-pressed={selectedForDelete}>{selectedForDelete?<Check size={15}/>:null}</button>}<button type="button" className="creative-preview" onClick={()=>showImage(image)} aria-label={`View creative ${index+1}`}><img src={image.url} alt={image.description||`Ad creative ${index+1}`} loading={index<3?"eager":"lazy"} decoding="async"/></button><div className="creative-card-actions"><button type="button" className="creative-collage-choice" disabled={saving||selectedOriginal===image.id} onClick={()=>void chooseOriginal(image)}>{selectedOriginal===image.id?<><CheckCircle2 size={14}/>Added to collage</>:<><Plus size={14}/>Add creative</>}</button><button type="button" className="creative-redesign-choice" disabled={Boolean(redesignTarget)} onClick={()=>void triggerAdRedesign(image.id,image.url)}><Sparkles size={13}/>{redesignTarget===image.id?"Redesigning image…":"Redesign This Creative"}</button></div></article>})}</div>:<div className="gallery-empty"><ImageIcon/><strong>No original images</strong><p>Add an original creative before generating a comparison collage.</p></div>}
      </section>
      <section className="business-section redesign-section" onPaste={handlePaste}><div className="section-heading"><div><span className="technical">Chalkframe output</span><h2>Redesign</h2></div><button onClick={()=>setRedesigns([...redesigns,{url:"",description:""}])}><Plus size={15}/>Add redesign</button></div><p className="section-intro">Paste a copied image to compress, upload, and save it automatically—or paste an existing image link into an Image URL field.</p><div className="fb-ad-processor-card"><div className="fb-ad-header"><Sparkles size={15}/><strong>Facebook Ad Library URL Redesign</strong></div><div className="fb-ad-inputs"><input type="url" value={fbAdUrl} onChange={e=>setFbAdUrl(e.target.value)} placeholder="Paste Facebook Ad Library image URL (scontent-*.fbcdn.net)..."/><button type="button" disabled={Boolean(redesignTarget)||!fbAdUrl.trim()} onClick={()=>{const u=fbAdUrl.trim();setFbAdUrl("");void triggerAdRedesign(undefined,u)}}><Sparkles size={13}/>{redesignTarget==="fb_url"?"Processing URL…":"Fetch & Redesign"}</button></div></div><label className="chatgpt-field">ChatGPT URL <span>Optional</span><input type="url" value={chatgptUrl} onChange={event=>setChatgptUrl(event.target.value)} placeholder="https://chatgpt.com/share/..."/></label><div className={`paste-image-zone ${uploading?"uploading":""}`} tabIndex={0} onPaste={handlePaste}><ImageIcon size={21}/><div><strong>{uploading?"Optimizing and uploading…":"Paste a copied image here"}</strong><span>Click this area, then press ⌘V or Ctrl+V · PNG, JPEG, GIF, or WebP up to 4 MB</span></div></div><div className="redesign-editor">{redesigns.map((image,index)=><div className="redesign-card" key={image.id||index}>{image.url?<button type="button" className="redesign-preview" onClick={()=>showImage(image)} aria-label={`View redesign ${index+1}`}><img src={image.url} alt={`Redesign ${index+1}`} loading="lazy" decoding="async"/></button>:<div className="redesign-placeholder"><ImageIcon size={26}/><span>Preview</span></div>}<div className="redesign-fields"><label>Image URL<input type="url" value={image.url} onChange={e=>setRedesigns(redesigns.map((item,i)=>i===index?{...item,url:e.target.value}:item))} placeholder="Paste an image URL"/></label><label>Description<input value={image.description||""} onChange={e=>setRedesigns(redesigns.map((item,i)=>i===index?{...item,description:e.target.value}:item))} placeholder="What changed in this redesign"/></label></div>{redesigns.length>1&&<button className="remove-redesign" aria-label="Remove redesign" onClick={()=>setRedesigns(redesigns.filter((_,i)=>i!==index))}><X size={14}/></button>}</div>)}</div></section>
      {redesigns.some(image=>image.url)&&<section className="business-section comparison-section"><div className="section-heading"><div><span className="technical">Automatic output</span><h2>Collages + email drafts</h2></div><span>16:9 · no cropping</span></div><div className="comparison-grid">{redesigns.filter(image=>image.url).map((image,index)=><CollageCard key={image.id||index} image={image} index={index} hasOriginal={originals.length>0} selectedOriginal={Boolean(selectedOriginal)} recipientEmail={image.emailDraft?.recipientEmail||lead.email} onOpen={showImage} onRetry={()=>void queueCollages(selectedOriginal,true)} onRegenerate={()=>void regenerateEmail(image)} onSend={()=>void sendDraftEmail(image)} sending={sendingDraftId===image.emailDraft?.id}/>)}</div></section>}
    </div><aside className="business-sidebar">
      <section className="fact-card"><span className="technical">Business details</span><h2>Contact record</h2><Fact label="Facebook" value={lead.facebook_url} link/><Fact label="Instagram" value={lead.instagram_url} link/><Fact label="Email" value={lead.email} icon={<Mail size={14}/>} href={lead.email?`mailto:${lead.email}`:undefined}/><Fact label="Phone" value={lead.phone} icon={<Phone size={14}/>} href={lead.phone?`tel:${lead.phone}`:undefined}/><Fact label="Website" value={lead.website_status==="no"?"No website found":lead.website_url||"Not checked"} link={Boolean(lead.website_url)}/><div className="research-notes"><span>Employee notes</span><p>{lead.notes||"No additional information was added."}</p></div><div className="completed-meta"><span>Research owner</span><strong>{lead.completed_by_name||"Not completed"}</strong>{lead.completed_at&&<small>{new Date(lead.completed_at).toLocaleString("en-IN",{dateStyle:"medium",timeStyle:"short"})}</small>}</div></section>
      <section className="admin-note-card"><div><StickyNote size={17}/><span className="technical">Private admin notes</span></div><p>Only administrators can read these notes.</p><textarea rows={8} value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Add follow-up context, positioning ideas, or contact outcomes…"/></section>
      {(message||error)&&<div className={`workspace-message ${error?"error":""}`}>{error||message}</div>}<button className="save-workspace" onClick={save} disabled={saving}><Save size={16}/>{saving?"Saving…":"Save workspace"}</button><button className="delete-business" onClick={()=>setConfirmDelete(true)} disabled={saving}><Trash2 size={15}/>Delete business</button>
    </aside></div>{selectedImage&&<div className="image-lightbox" role="dialog" aria-modal="true" aria-label="Creative preview" onMouseDown={event=>{if(event.target===event.currentTarget)setSelectedImage(null)}}><div className="lightbox-card"><button className="lightbox-close" onClick={()=>setSelectedImage(null)} aria-label="Close image preview"><X size={20}/></button><div className="lightbox-art"><img src={selectedImage.url} alt={selectedImage.description||"Creative preview"}/></div><aside><span className="technical">Image description</span><p>{selectedImage.description||"No description was added for this image."}</p><button className="copy-description" onClick={copyDescription} disabled={!selectedImage.description}>{copied?<><Check size={16}/>Copied</>:<><Copy size={16}/>Copy description</>}</button><a href={selectedImage.url} target="_blank" rel="noreferrer">Open original image <ArrowUpRight size={13}/></a></aside></div></div>}{confirmCreativeDelete&&<div className="modal-backdrop"><div className="confirm-delete creative-delete-confirm" role="alertdialog" aria-modal="true" aria-labelledby="creative-delete-title"><span><AlertTriangle size={20}/></span><h2 id="creative-delete-title">Permanently delete {selectedCreativeIds.length} creative{selectedCreativeIds.length===1?"":"s"}?</h2><p>This cannot be undone. The selected creative{selectedCreativeIds.length===1?"":"s"} will be removed from this business and permanently deleted from Chalkframe’s R2 storage. Existing redesigns will remain, but their original source reference may be cleared.</p><div><button className="secondary-button" onClick={()=>setConfirmCreativeDelete(false)} disabled={deletingCreatives}>Cancel</button><button className="danger-button" onClick={()=>void deleteSelectedCreatives()} disabled={deletingCreatives}>{deletingCreatives?"Deleting…":`Delete ${selectedCreativeIds.length} creative${selectedCreativeIds.length===1?"":"s"}`}</button></div></div></div>}{confirmDelete&&<div className="modal-backdrop"><div className="confirm-delete" role="alertdialog" aria-modal="true" aria-labelledby="delete-title"><span><Trash2 size={20}/></span><h2 id="delete-title">Delete this business?</h2><p>“{lead.title||"Meta ad business"}” and all its research and redesign images will be permanently removed.</p><div><button className="secondary-button" onClick={()=>setConfirmDelete(false)} disabled={saving}>Cancel</button><button className="danger-button" onClick={remove} disabled={saving}>{saving?"Deleting…":"Yes, delete business"}</button></div></div></div>}
  </main>
}

function CollageCard({image,index,hasOriginal,selectedOriginal,recipientEmail,onOpen,onRetry,onRegenerate,onSend,sending}:{image:BusinessImage;index:number;hasOriginal:boolean;selectedOriginal:boolean;recipientEmail:string|null;onOpen:(image:BusinessImage)=>void;onRetry:()=>void;onRegenerate:()=>void;onSend:()=>void;sending:boolean}){
  if(image.collageUrl&&image.collageStatus==="completed")return <article className="collage-card ready"><button onClick={()=>onOpen({url:image.collageUrl||"",description:`16:9 comparison collage ${index+1}`})}><img src={image.collageUrl} alt={`Original and redesign comparison ${index+1}`} loading="lazy" decoding="async"/></button><footer><CheckCircle2 size={14}/><span>Collage ready</span><a href={image.collageUrl} target="_blank" rel="noreferrer">Open <ArrowUpRight size={12}/></a></footer><EmailDraftPanel draft={image.emailDraft} recipientEmail={recipientEmail} onRegenerate={onRegenerate} onSend={onSend} sending={sending}/></article>;
  if(!hasOriginal)return <article className="collage-card collage-state"><Images size={24}/><strong>Original creative needed</strong><span>Add an original ad image to create this collage.</span></article>;
  if(!selectedOriginal)return <article className="collage-card collage-state"><Images size={24}/><strong>Choose an original</strong><span>Click “Add creative” on the image to place on the left.</span></article>;
  if(image.collageStatus==="failed")return <article className="collage-card collage-state failed"><RefreshCw size={23}/><strong>Collage needs a retry</strong><span>{image.collageError||"One of the source images could not be loaded."}</span><button onClick={onRetry}>Retry collage</button></article>;
  return <article className="collage-card collage-state processing"><Clock3 size={23}/><strong>{image.collageStatus==="processing"?"Creating collage":"Collage queued"}</strong><span>You can leave this page. It will appear here when ready.</span></article>;
}

function EmailDraftPanel({draft,recipientEmail,onRegenerate,onSend,sending}:{draft:BusinessImage["emailDraft"];recipientEmail:string|null;onRegenerate:()=>void;onSend:()=>void;sending:boolean}){
  const [copiedDraft,setCopiedDraft]=useState(false);
  async function copyDraft(){if(!draft?.subject||!draft.body)return;const text=`Subject: ${draft.subject}\n\n${draft.body}`;try{await navigator.clipboard.writeText(text)}catch{const field=document.createElement("textarea");field.value=text;field.style.position="fixed";field.style.opacity="0";document.body.appendChild(field);field.select();document.execCommand("copy");field.remove()}setCopiedDraft(true);window.setTimeout(()=>setCopiedDraft(false),1800)}
  if(!draft||["queued","processing"].includes(draft.status))return <div className="email-draft-state processing"><Clock3 size={17}/><div><strong>{draft?.status==="processing"?"Drafting outreach email":"Email draft queued"}</strong><span>The collage is being analyzed in the background.</span></div></div>;
  if(draft.status==="waiting")return <div className="email-draft-state"><Bot size={17}/><div><strong>Email generation paused</strong><span>Enable it from AI email settings, then regenerate.</span></div><button onClick={onRegenerate}>Generate</button></div>;
  if(draft.status==="needs_review")return <div className="email-draft-review"><AlertTriangle size={17}/><div><strong>Redesign needs review</strong><p>{draft.reviewReason||"The redesign was not clearly stronger than the original."}</p></div><button onClick={onRegenerate}><RefreshCw size={13}/>Recheck</button></div>;
  if(["failed","blocked"].includes(draft.status))return <div className="email-draft-review failed"><AlertTriangle size={17}/><div><strong>Email not generated</strong><p>{draft.error||"Check the AI settings and try again."}</p></div><button onClick={onRegenerate}><RefreshCw size={13}/>Retry</button></div>;
  return <div className="email-draft-ready"><header><div><Mail size={15}/><span>Drafted email</span></div><button onClick={onRegenerate} title="Regenerate email"><RefreshCw size={13}/></button></header><strong>Subject: {draft.subject}</strong><p>{draft.body}</p><footer><span>{draft.model||"OpenRouter"}{draft.costUsd!==null&&draft.costUsd!==undefined?` · $${Number(draft.costUsd).toFixed(4)}`:""}</span><button onClick={copyDraft}>{copiedDraft?<Check size={13}/>:<Copy size={13}/>} {copiedDraft?"Copied":"Copy email"}</button></footer><div className={`draft-delivery-action ${draft.sentAt?"sent":""}`}>{draft.sentAt?<><CheckCircle2 size={14}/><span>Sent {new Date(draft.sentAt).toLocaleString("en-IN",{dateStyle:"medium",timeStyle:"short"})}</span></>:<button type="button" onClick={onSend} disabled={sending||!recipientEmail}><Send size={13}/>{sending?"Sending…":recipientEmail?`Send to ${recipientEmail}`:"Business email missing"}</button>}</div></div>;
}

function Fact({label,value,link,href,icon}:{label:string;value:string|null;link?:boolean;href?:string;icon?:React.ReactNode}){const target=href||(link&&value?value:undefined);return <div className="fact"><span>{label}</span>{target?<a href={target} target={target.startsWith("http")?"_blank":undefined} rel="noreferrer">{icon}{value}<ArrowUpRight size={11}/></a>:<strong>{value||"Not found"}</strong>}</div>}
