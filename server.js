const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// --- 1. CONFIGURAÇÃO DO VOLUME (Persistência) ---
// Define onde salvar os dados: Volume do Railway ou pasta local 'uploads'
const VOLUME_PATH = process.env.RAILWAY_VOLUME_MOUNT_PATH || (process.platform === 'win32' ? path.join(__dirname, 'uploads') : '/app/uploads');

console.log(`📂 Caminho do Volume: ${VOLUME_PATH}`);

// Garante que as pastas necessárias existam
try {
    if (!fs.existsSync(VOLUME_PATH)) fs.mkdirSync(VOLUME_PATH, { recursive: true });
    if (!fs.existsSync(path.join(VOLUME_PATH, 'images'))) fs.mkdirSync(path.join(VOLUME_PATH, 'images'), { recursive: true });
    if (!fs.existsSync(path.join(VOLUME_PATH, 'profiles'))) fs.mkdirSync(path.join(VOLUME_PATH, 'profiles'), { recursive: true });
    if (!fs.existsSync(path.join(VOLUME_PATH, 'posts'))) fs.mkdirSync(path.join(VOLUME_PATH, 'posts'), { recursive: true });
} catch (e) {
    console.error("Erro ao criar pastas:", e);
}

// Serve as imagens enviadas publicamente
app.use('/uploads', express.static(VOLUME_PATH));

// --- 2. SERVIR O SITE (FRONTEND) ---
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(__dirname));

// Rota inteligente para encontrar o index.html
app.get('/', (req, res) => {
    const paths = [
        path.join(__dirname, 'public', 'index.html'),
        path.join(__dirname, 'index.html')
    ];
    
    for (const p of paths) {
        if (fs.existsSync(p)) return res.sendFile(p);
    }
    
    res.send('ERRO: index.html não encontrado. Verifique a pasta public.');
});

// --- 3. CONFIGURAÇÃO DE UPLOAD (MULTER) ---
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, path.join(VOLUME_PATH, 'images')),
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        // Nome único para evitar conflitos
        cb(null, `img-${Date.now()}-${Math.round(Math.random() * 1E9)}${ext}`);
    }
});
const upload = multer({ storage: storage });

// --- 4. FUNÇÕES AUXILIARES ---
function getProfilePath(wallet) { return path.join(VOLUME_PATH, 'profiles', `${wallet.toLowerCase()}.json`); }
function getPostPath(filename) { return path.join(VOLUME_PATH, 'posts', filename); }

function readJson(filePath, defaultValue) {
    if (fs.existsSync(filePath)) {
        try {
            return JSON.parse(fs.readFileSync(filePath, 'utf8'));
        } catch (e) { return defaultValue; }
    }
    return defaultValue;
}

// --- 5. ROTAS DA API ---

// --- PERFIL ---
app.get('/api/get-profile/:wallet', (req, res) => {
    const data = readJson(getProfilePath(req.params.wallet), { 
        name: 'Guest', 
        followers: [], 
        following: [] 
    });
    res.json(data);
});

app.post('/api/save-profile', (req, res) => {
    const { wallet, data } = req.body;
    // Preserva seguidores/seguindo ao editar perfil
    const oldData = readJson(getProfilePath(wallet), {});
    const newData = { ...oldData, ...data };
    
    fs.writeFile(getProfilePath(wallet), JSON.stringify(newData), (err) => {
        if (err) return res.status(500).json({ error: 'Erro ao salvar' });
        res.json({ success: true });
    });
});

app.post('/api/upload', upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file' });
    res.json({ url: `/uploads/images/${req.file.filename}` });
});

// --- POSTS E FEED ---
app.post('/api/post', (req, res) => {
    const { wallet, text, image, name, avatar, originalPost } = req.body;
    
    const postData = {
        id: Date.now(),
        wallet, name, avatar, text, image,
        likes: [],
        originalPost: originalPost || null,
        timestamp: new Date().toISOString()
    };

    // Salva cada post em um arquivo separado
    const filename = `${postData.id}-${wallet.toLowerCase()}.json`;
    
    fs.writeFile(getPostPath(filename), JSON.stringify(postData), (err) => {
        if (err) return res.status(500).json({ error: 'Erro ao postar' });
        res.json({ success: true });
    });
});

// Rota para deletar post
app.post('/api/delete-post', (req, res) => {
    const { wallet, filename } = req.body;
    const filePath = getPostPath(filename);

    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Post não encontrado' });

    // Segurança: Verifica se a carteira que pede para deletar é a dona do post
    const post = readJson(filePath);
    if (post && post.wallet.toLowerCase() !== wallet.toLowerCase()) {
        return res.status(403).json({ error: 'Sem permissão' });
    }

    fs.unlink(filePath, (err) => {
        if (err) return res.status(500).json({ error: 'Erro ao deletar' });
        res.json({ success: true });
    });
});

app.get('/api/feed', (req, res) => {
    const postsDir = path.join(VOLUME_PATH, 'posts');
    const filterWallet = req.query.wallet ? req.query.wallet.toLowerCase() : null;
    
    fs.readdir(postsDir, (err, files) => {
        if (err) return res.json([]); 

        let posts = files
            .filter(f => f.endsWith('.json'))
            .map(f => {
                const p = readJson(path.join(postsDir, f), null);
                if(p) p.filename = f; // Importante para likes e delete
                return p;
            })
            .filter(p => p !== null);

        // Filtra por usuário se solicitado
        if (filterWallet) {
            posts = posts.filter(p => p.wallet && p.wallet.toLowerCase() === filterWallet);
        }

        posts.sort((a, b) => b.id - a.id); // Ordena do mais novo para o mais antigo

        res.json(posts);
    });
});

// --- INTERAÇÕES SOCIAIS ---

app.post('/api/like', (req, res) => {
    const { wallet, filename } = req.body;
    const filePath = getPostPath(filename);
    
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Post não encontrado' });
    
    const post = readJson(filePath);
    if (!post.likes) post.likes = [];

    const index = post.likes.indexOf(wallet);
    
    if (index === -1) {
        post.likes.push(wallet); // Like
    } else {
        post.likes.splice(index, 1); // Unlike
    }

    fs.writeFile(filePath, JSON.stringify(post), (err) => {
        if (err) return res.status(500).json({ error: 'Erro ao salvar like' });
        res.json({ success: true, likes: post.likes.length, hasLiked: index === -1 });
    });
});

app.post('/api/follow', (req, res) => {
    const { follower, target } = req.body;
    
    if (!follower || !target) return res.status(400).json({ error: 'Dados inválidos' });
    if (follower === target) return res.status(400).json({ error: 'Não pode seguir a si mesmo' });

    const fPath = getProfilePath(follower);
    const tPath = getProfilePath(target);
    
    const fProfile = readJson(fPath, { following: [] });
    if (!fProfile.following) fProfile.following = [];
    
    const tProfile = readJson(tPath, { followers: [] });
    if (!tProfile.followers) tProfile.followers = [];

    const index = fProfile.following.indexOf(target);
    let isFollowing = false;

    if (index === -1) {
        fProfile.following.push(target);
        tProfile.followers.push(follower);
        isFollowing = true;
    } else {
        fProfile.following.splice(index, 1);
        const tIndex = tProfile.followers.indexOf(follower);
        if (tIndex > -1) tProfile.followers.splice(tIndex, 1);
        isFollowing = false;
    }

    try {
        fs.writeFileSync(fPath, JSON.stringify(fProfile));
        fs.writeFileSync(tPath, JSON.stringify(tProfile));
        res.json({ success: true, isFollowing, followersCount: tProfile.followers.length });
    } catch (e) {
        res.status(500).json({ error: 'Erro ao salvar follow' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🔥 Emodak Server Social rodando na porta ${PORT}`));
