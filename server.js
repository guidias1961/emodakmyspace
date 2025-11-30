const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// --- 1. CONFIGURAÇÃO DO VOLUME (STORAGE) ---
// Define onde os arquivos serão salvos (Volume do Railway ou Pasta Local 'uploads')
const VOLUME_PATH = process.env.RAILWAY_VOLUME_MOUNT_PATH || (process.platform === 'win32' ? path.join(__dirname, 'uploads') : '/app/uploads');

console.log(`📂 Caminho do Volume definido para: ${VOLUME_PATH}`);

// Cria as pastas necessárias se não existirem
try {
    if (!fs.existsSync(VOLUME_PATH)) fs.mkdirSync(VOLUME_PATH, { recursive: true });
    if (!fs.existsSync(path.join(VOLUME_PATH, 'images'))) fs.mkdirSync(path.join(VOLUME_PATH, 'images'), { recursive: true });
    if (!fs.existsSync(path.join(VOLUME_PATH, 'profiles'))) fs.mkdirSync(path.join(VOLUME_PATH, 'profiles'), { recursive: true });
} catch (e) {
    console.error("Erro ao criar pastas do volume:", e);
}

// Serve as imagens salvas para o público
app.use('/uploads', express.static(VOLUME_PATH));

// --- 2. SERVIR O SITE (FRONTEND) ---
// Tenta servir arquivos estáticos da pasta 'public' e da raiz
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(__dirname));

// ROTA PRINCIPAL: Lógica "Inteligente" para achar o index.html
app.get('/', (req, res) => {
    const pathsToCheck = [
        path.join(__dirname, 'public', 'index.html'),
        path.join(__dirname, 'index.html'),
        path.join(__dirname, 'client', 'index.html') // Caso tenha ficado numa subpasta client
    ];

    let foundPath = null;

    // Procura o arquivo
    for (const p of pathsToCheck) {
        if (fs.existsSync(p)) {
            foundPath = p;
            break;
        }
    }

    if (foundPath) {
        res.sendFile(foundPath);
    } else {
        // SE NÃO ACHAR NADA, MOSTRA O DIAGNÓSTICO NA TELA
        const rootFiles = fs.readdirSync(__dirname);
        let publicFiles = [];
        try { publicFiles = fs.readdirSync(path.join(__dirname, 'public')); } catch(e) { publicFiles = ["(Pasta 'public' não existe)"]; }

        res.send(`
            <div style="font-family: monospace; background: #222; color: #0f0; padding: 20px;">
                <h1>⚠️ ERRO: index.html não encontrado</h1>
                <p>O servidor está rodando, mas não achou seu site.</p>
                <hr style="border-color: #555;">
                <h3>Arquivos na raiz do servidor:</h3>
                <pre>${rootFiles.join('\n')}</pre>
                <hr style="border-color: #555;">
                <h3>Arquivos na pasta 'public':</h3>
                <pre>${publicFiles.join('\n')}</pre>
                <hr style="border-color: #555;">
                <p>Verifique se você enviou a pasta 'public' para o GitHub.</p>
            </div>
        `);
    }
});

// --- 3. CONFIGURAÇÃO DE UPLOAD (MULTER) ---
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, path.join(VOLUME_PATH, 'images'));
    },
    filename: (req, file, cb) => {
        const wallet = req.body.wallet || 'unknown';
        const ext = path.extname(file.originalname);
        cb(null, `${wallet}-${Date.now()}${ext}`);
    }
});
const upload = multer({ storage: storage });

// --- 4. ROTAS DA API ---

// Salvar Perfil
app.post('/api/save-profile', (req, res) => {
    const { wallet, data } = req.body;
    if (!wallet) return res.status(400).json({ error: 'Wallet required' });

    const filePath = path.join(VOLUME_PATH, 'profiles', `${wallet.toLowerCase()}.json`);
    
    fs.writeFile(filePath, JSON.stringify(data), (err) => {
        if (err) {
            console.error("Erro ao salvar:", err);
            return res.status(500).json({ error: 'Failed to save' });
        }
        res.json({ success: true });
    });
});

// Ler Perfil
app.get('/api/get-profile/:wallet', (req, res) => {
    const wallet = req.params.wallet.toLowerCase();
    const filePath = path.join(VOLUME_PATH, 'profiles', `${wallet}.json`);

    if (fs.existsSync(filePath)) {
        const data = fs.readFileSync(filePath, 'utf8');
        res.json(JSON.parse(data));
    } else {
        res.json(null);
    }
});

// Upload de Imagem
app.post('/api/upload-avatar', upload.single('avatar'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const imageUrl = `/uploads/images/${req.file.filename}`;
    res.json({ url: imageUrl });
});

// --- INICIAR ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🔥 Emodak Server rodando na porta ${PORT}`);
});
