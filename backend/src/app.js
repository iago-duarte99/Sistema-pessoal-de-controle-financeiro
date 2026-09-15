import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { fileURLToPath } from 'node:url';
import { config } from './config/env.js';
import { api } from './routes/api.js';
import { errorHandler, HttpError } from './middleware/errors.js';

export const app=express();
// Production ingress must have exactly one trusted proxy, with no direct public access.
// Trust only the socket hop; ignore client-supplied addresses farther to the left.
app.set('trust proxy', config.production ? 1 : false);
app.disable('x-powered-by');
app.use(helmet({contentSecurityPolicy:{directives:{'script-src':["'self'"],'style-src':["'self'","'unsafe-inline'"],'upgrade-insecure-requests':config.production?[]:null}},strictTransportSecurity:config.production?undefined:false}));
app.use(cors({origin(origin,callback){callback(origin&&!config.origins.includes(origin)?new HttpError(403,'Origem não autorizada.'):null,true);}}));
app.use(express.json({limit:'2mb'}));
app.use('/api',(req,res,next)=>{
  if(['POST','PUT'].includes(req.method)&&(!req.body||typeof req.body!=='object'||Array.isArray(req.body)))return res.status(400).json({error:'Envie um objeto JSON válido.'});
  next();
});
app.use('/api',(req,res,next)=>{res.set('Cache-Control','no-store');next();},api);
app.use('/api',(req,res)=>res.status(404).json({error:'Endpoint não encontrado.'}));
const root=fileURLToPath(new URL('../../',import.meta.url));
// Lista explícita: nunca publica .env, SQL, testes ou o diretório backend.
for(const file of ['index.html','app.js','styles.css','auth.css','js/api.js','js/migration.js','js/controller.js','js/password-reset.js','js/ux.js','js/import.js','js/import-schema.js','js/import-worker.js','assets/finance-1.svg','assets/finance-2.svg','assets/finance-3.svg']) app.get('/'+file,(req,res)=>res.sendFile(file,{root}));
app.get('/vendor/exceljs.min.js',(req,res)=>res.sendFile('backend/node_modules/exceljs/dist/exceljs.min.js',{root}));
app.get('/reset-password',(req,res)=>{res.set({'Cache-Control':'no-store','Referrer-Policy':'no-referrer'});res.sendFile('index.html',{root});});
app.get('/',(req,res)=>{res.set('Cache-Control','no-store');res.sendFile('index.html',{root});});
app.use(errorHandler);
