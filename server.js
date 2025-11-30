const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// --- 1. CONFIGURAÇÃO DO VOLUME ---
const VOLUME_PATH = process.env.RAILWAY_VOLUME_MOUNT_PATH || (process.platform === 'win32' ? path.join(__dirname, 'uploads') : '/app/uploads');

console.log(`📂 Caminho do Volume: ${VOLUME_PATH}`);

// Garante pastas (Adicionei a pasta 'posts')
try {
    if (!fs.existsSync(VOLUME_PATH)) fs.mkdirSync(VOLUME_PATH, { recursive: true });
    if (!fs.existsSync(path.join(VOLUME_PATH, 'images'))) fs.mkdirSync(path.join(VOLUME_PATH, 'images'), { recursive: true });
    if (!fs.existsSync(path.join(VOLUME_PATH, 'profiles'))) fs.mkdirSync(path.join(VOLUME_PATH, 'profiles'), { recursive: true });
    if (!fs.existsSync(path.join(VOLUME_PATH, 'posts'))) fs.mkdirSync(path.join(VOLUME_PATH, 'posts'), { recursive: true });
} catch (e) {
    console.error("Erro ao criar pastas:", e);
}

app.use('/uploads', express.static(VOLUME_PATH));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(__dirname));

// Rota para entregar o HTML
app.get('/', (req, res) => {
    const paths = [path.join(__dirname, 'public', 'index.html'), path.join(__dirname, 'index.html')];
    for (const p of paths) if (fs.existsSync(p)) return res.sendFile(p);
    res.send('Erro: index.html não encontrado.');
});

// Configuração de Upload
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, path.join(VOLUME_PATH, 'images')),
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        cb(null, `img-${Date.now()}-${Math.round(Math.random() * 1E9)}${ext}`);
    }
});
const upload = multer({ storage: storage });

// --- API ROTAS ---

// 1. Salvar Perfil
app.post('/api/save-profile', (req, res) => {
    const { wallet, data } = req.body;
    fs.writeFile(path.join(VOLUME_PATH, 'profiles', `${wallet.toLowerCase()}.json`), JSON.stringify(data), (err) => {
        if (err) return res.status(500).json({ error: 'Erro ao salvar' });
        res.json({ success: true });
    });
});

// 2. Ler Perfil (Com cache simples para não quebrar se não existir)
app.get('/api/get-profile/:wallet', (req, res) => {
    const p = path.join(VOLUME_PATH, 'profiles', `${req.params.wallet.toLowerCase()}.json`);
    if (fs.existsSync(p)) res.json(JSON.parse(fs.readFileSync(p, 'utf8')));
    else res.json({ name: 'Unknown Emo', avatar: 'https://placehold.co/300' });
});

// 3. Upload Imagem
app.post('/api/upload', upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file' });
    res.json({ url: `/uploads/images/${req.file.filename}` });
});

// --- NOVO: LÓGICA DO FEED ---

// 4. Criar Post
app.post('/api/post', (req, res) => {
    const { wallet, text, image, name, avatar } = req.body;
    
    const postData = {
        id: Date.now(), // Timestamp como ID
        wallet,
        name,
        avatar,
        text,
        image,
        timestamp: new Date().toISOString()
    };

    // Salva cada post como um arquivo JSON individual
    const filename = `${postData.id}-${wallet.toLowerCase()}.json`;
    fs.writeFile(path.join(VOLUME_PATH, 'posts', filename), JSON.stringify(postData), (err) => {
        if (err) return res.status(500).json({ error: 'Erro ao postar' });
        res.json({ success: true, post: postData });
    });
});

// 5. Ler Feed (Lê todos os arquivos da pasta posts e ordena)
app.get('/api/feed', (req, res) => {
    const postsDir = path.join(VOLUME_PATH, 'posts');
    fs.readdir(postsDir, (err, files) => {
        if (err) return res.json([]);

        const posts = files
            .filter(f => f.endsWith('.json'))
            .map(f => {
                try {
                    return JSON.parse(fs.readFileSync(path.join(postsDir, f), 'utf8'));
                } catch (e) { return null; }
            })
            .filter(p => p !== null)
            .sort((a, b) => b.id - a.id); // Ordena do mais novo para o mais velho

        res.json(posts);
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🔥 Server On: ${PORT}`));
