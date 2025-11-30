const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// --- 1. CONFIGURAÇÃO DO VOLUME (Persistência no Railway) ---
const VOLUME_PATH = process.env.RAILWAY_VOLUME_MOUNT_PATH || (process.platform === 'win32' ? path.join(__dirname, 'uploads') : '/app/uploads');

console.log(`📂 Caminho do Volume: ${VOLUME_PATH}`);

// Garante que as pastas necessárias existem
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

// Rota inteligente para achar o index.html onde quer que ele esteja
app.get('/', (req, res) => {
    const paths = [
        path.join(__dirname, 'public', 'index.html'),
        path.join(__dirname, 'index.html')
    ];
    
    for (const p of paths) {
        if (fs.existsSync(p)) return res.sendFile(p);
    }
    
    res.send('ERRO: index.html não encontrado. Verifique se a pasta public foi enviada.');
});

// --- 3. CONFIGURAÇÃO DE UPLOAD (MULTER) ---
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, path.join(VOLUME_PATH, 'images')),
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        // Nome único: img-timestamp-random.ext
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
    // Lê dados antigos para não perder seguidores/seguindo
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
        likes: [], // Array de wallets que deram like
        originalPost: originalPost || null, // Dados do post original se for repost
        timestamp: new Date().toISOString()
    };

    // Salva arquivo único por post: 123456789-0xabc.json
    const filename = `${postData.id}-${wallet.toLowerCase()}.json`;
    
    fs.writeFile(getPostPath(filename), JSON.stringify(postData), (err) => {
        if (err) return res.status(500).json({ error: 'Erro ao postar' });
        res.json({ success: true });
    });
});

app.get('/api/feed', (req, res) => {
    const postsDir = path.join(VOLUME_PATH, 'posts');
    
    fs.readdir(postsDir, (err, files) => {
        if (err) return res.json([]); // Se pasta vazia ou erro, retorna array vazio

        const posts = files
            .filter(f => f.endsWith('.json'))
            .map(f => {
                const p = readJson(path.join(postsDir, f), null);
                if(p) p.filename = f; // Importante: Guarda o nome do arquivo para poder dar like depois
                return p;
            })
            .filter(p => p !== null)
            .sort((a, b) => b.id - a.id); // Mais recente primeiro

        res.json(posts);
    });
});

// --- INTERAÇÕES SOCIAIS ---

// Like / Unlike
app.post('/api/like', (req, res) => {
    const { wallet, filename } = req.body;
    const filePath = getPostPath(filename);
    
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Post não encontrado' });
    
    const post = readJson(filePath);
    if (!post.likes) post.likes = [];

    const index = post.likes.indexOf(wallet);
    
    if (index === -1) {
        post.likes.push(wallet); // Dar Like
    } else {
        post.likes.splice(index, 1); // Remover Like
    }

    fs.writeFile(filePath, JSON.stringify(post), (err) => {
        if (err) return res.status(500).json({ error: 'Erro ao salvar like' });
        res.json({ success: true, likes: post.likes.length, hasLiked: index === -1 });
    });
});

// Follow / Unfollow
app.post('/api/follow', (req, res) => {
    const { follower, target } = req.body;
    
    if (!follower || !target) return res.status(400).json({ error: 'Dados inválidos' });
    if (follower === target) return res.status(400).json({ error: 'Não pode seguir a si mesmo' });

    // 1. Atualiza quem está seguindo (Follower)
    const followerPath = getProfilePath(follower);
    const followerProfile = readJson(followerPath, { following: [] });
    if (!followerProfile.following) followerProfile.following = [];

    // 2. Atualiza quem está sendo seguido (Target)
    const targetPath = getProfilePath(target);
    const targetProfile = readJson(targetPath, { followers: [] });
    if (!targetProfile.followers) targetProfile.followers = [];

    const index = followerProfile.following.indexOf(target);
    let isFollowing = false;

    if (index === -1) {
        // Seguir
        followerProfile.following.push(target);
        targetProfile.followers.push(follower);
        isFollowing = true;
    } else {
        // Deixar de seguir
        followerProfile.following.splice(index, 1);
        const tIndex = targetProfile.followers.indexOf(follower);
        if (tIndex > -1) targetProfile.followers.splice(tIndex, 1);
        isFollowing = false;
    }

    // Salva ambos os perfis
    try {
        fs.writeFileSync(followerPath, JSON.stringify(followerProfile));
        fs.writeFileSync(targetPath, JSON.stringify(targetProfile));
        res.json({ success: true, isFollowing, followersCount: targetProfile.followers.length });
    } catch (e) {
        res.status(500).json({ error: 'Erro ao salvar follow' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🔥 Emodak Server Social rodando na porta ${PORT}`));
