import { app, BrowserWindow, dialog } from "electron";
import { join } from "node:path";
let window, stopApi;
const locked=app.requestSingleInstanceLock();if(!locked)app.quit();
async function create(){process.env.SHOWTIMES_PROFILE_DIR=join(app.getPath("userData"),"browser-profile");const api=await import("../src/index.js");stopApi=api.stopApiServer;await api.startApiServer(4173);window=new BrowserWindow({width:1400,height:960,minWidth:880,minHeight:700,backgroundColor:"#0d0b12",title:"Showtimes Radar",autoHideMenuBar:true,webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true}});await window.loadURL("http://127.0.0.1:4173")}
if(locked){app.whenReady().then(create).catch(error=>{dialog.showErrorBox("Showtimes Radar 啟動失敗",error instanceof Error?error.message:String(error));app.quit()});app.on("second-instance",()=>{if(window){if(window.isMinimized())window.restore();window.focus()}});app.on("activate",()=>{if(BrowserWindow.getAllWindows().length===0)create()});app.on("window-all-closed",()=>{if(process.platform!=="darwin")app.quit()});app.on("before-quit",()=>{void stopApi?.()})}
