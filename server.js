const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// --- CONFIGURAÇÃO DO VOLUME ---
// No Railway, montamos o volume em /app/uploads.
// Localmente, ele cria uma pasta 'uploads' na raiz.
const VOLUME_PATH = process.path === '/app' ? '/app/uploads' : path.join(__dirname, 'uploads');

// Garante que as pastas existem
if (!fs.existsSync(VOLUME_PATH)) fs.mkdirSync(VOLUME_PATH, { recursive: true });
if (!fs.existsSync(path.join(VOLUME_PATH, 'images'))) fs.mkdirSync(path.join(VOLUME_PATH, 'images'), { recursive: true });
if (!fs.existsSync(path.join(VOLUME_PATH, 'profiles'))) fs.mkdirSync(path.join(VOLUME_PATH, 'profiles'), { recursive: true });

// Servir os arquivos estáticos (HTML e Imagens enviadas)
app.use(express.static('public')); // Serve o index.html da pasta public
app.use('/uploads', express.static(VOLUME_PATH)); // Serve as imagens do volume publicamente

// --- UPLOAD DE IMAGEM (MULTER) ---
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, path.join(VOLUME_PATH, 'images'));
    },
    filename: (req, file, cb) => {
        // Nome do arquivo: wallet-timestamp.png
        const wallet = req.body.wallet || 'unknown';
        const ext = path.extname(file.originalname);
        cb(null, `${wallet}-${Date.now()}${ext}`);
    }
});
const upload = multer({ storage: storage });

// ROTA 1: Salvar Perfil (JSON)
app.post('/api/save-profile', (req, res) => {
    const { wallet, data } = req.body;
    if (!wallet) return res.status(400).json({ error: 'Wallet required' });

    const filePath = path.join(VOLUME_PATH, 'profiles', `${wallet.toLowerCase()}.json`);
    
    fs.writeFile(filePath, JSON.stringify(data), (err) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ error: 'Failed to write to volume' });
        }
        res.json({ success: true, message: 'Saved to Volume' });
    });
});

// ROTA 2: Ler Perfil
app.get('/api/get-profile/:wallet', (req, res) => {
    const wallet = req.params.wallet.toLowerCase();
    const filePath = path.join(VOLUME_PATH, 'profiles', `${wallet}.json`);

    if (fs.existsSync(filePath)) {
        const data = fs.readFileSync(filePath, 'utf8');
        res.json(JSON.parse(data));
    } else {
        res.json(null); // Usuário novo
    }
});

// ROTA 3: Upload de Avatar
app.post('/api/upload-avatar', upload.single('avatar'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    
    // Retorna a URL pública da imagem
    const imageUrl = `/uploads/images/${req.file.filename}`;
    res.json({ url: imageUrl });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🔥 Server running on port ${PORT}`);
    console.log(`📂 Volume mounted at: ${VOLUME_PATH}`);
});
