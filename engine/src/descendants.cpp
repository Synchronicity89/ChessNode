#include "engine.h"
#include <string>
#include <vector>
#include <sstream>
#include <cstring>
#include <cctype>
#include <algorithm>
#include <unordered_set>

static std::string g_lastJson; // static buffer for returned JSON

namespace {
struct Pos {
    char board[8][8];
    char stm;
    std::string castling;
    std::string ep;
    int half;
    int full;
};

struct Options {
    bool includeCastling = true;
    bool includeEnPassant = true;
    std::string promotions = "qrbn"; // order matters
    int capPerParent = 0; // 0 = unlimited
    bool uniquePerPly = false; // dedupe identical child FENs per ply
    bool castleSafety = true; // verify path clear and no attacks on path/destination
};

inline bool isWhite(char p) { return p >= 'A' && p <= 'Z'; }
inline bool isBlack(char p) { return p >= 'a' && p <= 'z'; }
inline bool inBounds(int r, int c) { return r >= 0 && r < 8 && c >= 0 && c < 8; }

bool parseFEN(const char *fen, Pos &out) {
    if (!fen) return false;
    std::istringstream iss(fen);
    std::string boardPart;
    if (!(iss >> boardPart >> out.stm >> out.castling >> out.ep >> out.half >> out.full))
        return false;
    std::vector<std::string> rows;
    std::stringstream ss(boardPart);
    std::string seg;
    while (std::getline(ss, seg, '/')) rows.push_back(seg);
    if (rows.size() != 8) return false;
    for (int r = 0; r < 8; r++) {
        int c = 0;
        for (char ch : rows[r]) {
            if (ch >= '1' && ch <= '8') {
                int n = ch - '0';
                for (int k = 0; k < n; k++) out.board[r][c++] = '.';
            } else {
                if (c >= 8) return false;
                out.board[r][c++] = ch;
            }
        }
        if (c != 8) return false;
    }
    return true;
}

struct Move { int fr, fc, tr, tc; char promo; };
void addMove(std::vector<Move> &mv, int fr, int fc, int tr, int tc, char promo = '\0') { mv.push_back({fr, fc, tr, tc, promo}); }

void genPawn(const Pos &p, const Options &opt, int r, int c, bool white, std::vector<Move> &mv) {
    int dir = white ? -1 : +1;
    int startRank = white ? 6 : 1;
    int lastRank = white ? 0 : 7;
    int oneR = r + dir;
    if (inBounds(oneR, c) && p.board[oneR][c] == '.') {
        if (oneR == lastRank) {
            for (char pr : opt.promotions) addMove(mv, r, c, oneR, c, pr);
        } else {
            addMove(mv, r, c, oneR, c);
        }
        int twoR = r + 2 * dir;
        if (r == startRank && p.board[twoR][c] == '.') addMove(mv, r, c, twoR, c);
    }
    for (int dc : {-1, 1}) {
        int tr = r + dir, tc = c + dc;
        if (!inBounds(tr, tc)) continue;
        char tgt = p.board[tr][tc];
        if (tgt != '.' && (white ? isBlack(tgt) : isWhite(tgt))) {
            if (tr == lastRank) {
                for (char pr : opt.promotions) addMove(mv, r, c, tr, tc, pr);
            } else addMove(mv, r, c, tr, tc);
        }
    }
    if (opt.includeEnPassant && p.ep != "-" && p.ep.size() == 2) {
        int file = p.ep[0] - 'a';
        int rank = p.ep[1] - '0';
        int epR = 8 - rank;
        if (epR == r + dir && std::abs(file - c) == 1) addMove(mv, r, c, epR, file);
    }
}

void genLeaper(const Pos &p, int r, int c, bool white, std::vector<Move> &mv, const int del[][2], int n) {
    for (int i = 0; i < n; i++) {
        int tr = r + del[i][0], tc = c + del[i][1];
        if (!inBounds(tr, tc)) continue;
        char tgt = p.board[tr][tc];
        if (tgt == '.' || (white ? isBlack(tgt) : isWhite(tgt))) addMove(mv, r, c, tr, tc);
    }
}

void genSlider(const Pos &p, int r, int c, bool white, std::vector<Move> &mv, const int del[][2], int n) {
    for (int i = 0; i < n; i++) {
        int dr = del[i][0], dc = del[i][1];
        int tr = r + dr, tc = c + dc;
        while (inBounds(tr, tc)) {
            char tgt = p.board[tr][tc];
            if (tgt == '.') { addMove(mv, r, c, tr, tc); }
            else { if (white ? isBlack(tgt) : isWhite(tgt)) addMove(mv, r, c, tr, tc); break; }
            tr += dr; tc += dc;
        }
    }
}

// Forward declaration for attack detection used in genKing
std::vector<Move> genPseudo(const Pos &p, const Options &opt);

void genKing(const Pos &p, const Options &opt, int r, int c, bool white, std::vector<Move> &mv) {
    const int d[8][2] = {{1, 0}, {-1, 0}, {0, 1}, {0, -1}, {1, 1}, {1, -1}, {-1, 1}, {-1, -1}};
    genLeaper(p, r, c, white, mv, d, 8);
    if (!opt.includeCastling) return;

    auto isEmpty = [&](int rr,int cc){ return inBounds(rr,cc) && p.board[rr][cc]=='.'; };
    auto findKingPos = [&](bool w){
        for (int rr=0; rr<8; ++rr) for (int cc=0; cc<8; ++cc){
            if (w && p.board[rr][cc]=='K') return std::pair<int,int>(rr,cc);
            if (!w && p.board[rr][cc]=='k') return std::pair<int,int>(rr,cc);
        }
        return std::pair<int,int>(-1,-1);
    };
    auto squareAttacked = [&](int rr,int cc, bool byWhite){
        Pos tmp = p; tmp.stm = byWhite? 'w':'b';
        Options o2 = opt; o2.includeCastling = false; // exclude castling from attack detection
        auto attacks = genPseudo(tmp, o2);
        for (const auto &m : attacks) if (m.tr==rr && m.tc==cc) return true; return false;
    };
    auto canCastle = [&](bool w, bool kingSide){
        // Require castling rights flag
        if (w){ if (kingSide && p.castling.find('K')==std::string::npos) return false; if (!kingSide && p.castling.find('Q')==std::string::npos) return false; }
        else { if (kingSide && p.castling.find('k')==std::string::npos) return false; if (!kingSide && p.castling.find('q')==std::string::npos) return false; }
        // King origin must match standard file (we rely on rights but still use path squares)
        int kr = w?7:0; int kc = 4;
        // Path squares must be empty between king and rook
        if (kingSide){
            if (!isEmpty(kr,5) || !isEmpty(kr,6)) return false; // f,g
        } else {
            if (!isEmpty(kr,1) || !isEmpty(kr,2) || !isEmpty(kr,3)) return false; // b,c,d
        }
        if (!opt.castleSafety) return true; // no safety checks requested
        // King may not be in check, nor pass through or land on attacked squares
        // Determine opponent side
        bool oppWhite = !w;
        if (squareAttacked(kr,kc, oppWhite)) return false; // starting square in check
        if (kingSide){
            if (squareAttacked(kr,5, oppWhite)) return false; // f
            if (squareAttacked(kr,6, oppWhite)) return false; // g
        } else {
            if (squareAttacked(kr,3, oppWhite)) return false; // d
            if (squareAttacked(kr,2, oppWhite)) return false; // c
        }
        return true;
    };

    if (white) {
        if (canCastle(true, true)) addMove(mv, r, c, 7, 6);
        if (canCastle(true, false)) addMove(mv, r, c, 7, 2);
    } else {
        if (canCastle(false, true)) addMove(mv, r, c, 0, 6);
        if (canCastle(false, false)) addMove(mv, r, c, 0, 2);
    }
}

std::vector<Move> genPseudo(const Pos &p, const Options &opt) {
    std::vector<Move> mv;
    bool white = p.stm == 'w';
    for (int r = 0; r < 8; r++) for (int c = 0; c < 8; c++) {
        char ch = p.board[r][c];
        if (ch == '.') continue;
        if (white && !isWhite(ch)) continue;
        if (!white && !isBlack(ch)) continue;
        switch (std::tolower(static_cast<unsigned char>(ch))) {
            case 'p': genPawn(p, opt, r, c, white, mv); break;
            case 'n': { const int nd[8][2] = {{2, 1}, {2, -1}, {-2, 1}, {-2, -1}, {1, 2}, {1, -2}, {-1, 2}, {-1, -2}}; genLeaper(p, r, c, white, mv, nd, 8); } break;
            case 'b': { const int bd[4][2] = {{1, 1}, {1, -1}, {-1, 1}, {-1, -1}}; genSlider(p, r, c, white, mv, bd, 4); } break;
            case 'r': { const int rd[4][2] = {{1, 0}, {-1, 0}, {0, 1}, {0, -1}}; genSlider(p, r, c, white, mv, rd, 4); } break;
            case 'q': { const int qd[8][2] = {{1, 0}, {-1, 0}, {0, 1}, {0, -1}, {1, 1}, {1, -1}, {-1, 1}, {-1, -1}}; genSlider(p, r, c, white, mv, qd, 8); } break;
            case 'k': genKing(p, opt, r, c, white, mv); break;
        }
    }
    if (opt.capPerParent > 0 && static_cast<int>(mv.size()) > opt.capPerParent) mv.resize(opt.capPerParent);
    return mv;
}

std::string toFEN(const Pos &p) {
    std::ostringstream b;
    for (int r = 0; r < 8; r++) {
        int run = 0;
        for (int c = 0; c < 8; c++) {
            char ch = p.board[r][c];
            if (ch == '.') { run++; }
            else { if (run) { b << run; run = 0; } b << ch; }
        }
        if (run) b << run;
        if (r < 7) b << '/';
    }
    std::ostringstream fen;
    fen << b.str() << ' ' << p.stm << ' ' << (p.castling.empty() ? "-" : p.castling) << ' ' << (p.ep.empty() ? "-" : p.ep) << ' ' << p.half << ' ' << p.full;
    return fen.str();
}

Pos applyMove(const Pos &p, const Move &m) {
    Pos np = p;
    char piece = np.board[m.fr][m.fc];
    bool white = isWhite(piece);
    if (std::tolower(static_cast<unsigned char>(piece)) == 'p' && p.ep != "-" && m.tr == (8 - (p.ep[1] - '0')) && ((p.ep[0] - 'a') == m.tc) && np.board[m.tr][m.tc] == '.') {
        int capR = white ? m.tr + 1 : m.tr - 1;
        np.board[capR][m.tc] = '.';
    }
    if (std::tolower(static_cast<unsigned char>(piece)) == 'k' && std::abs(m.tc - m.fc) == 2) {
        if (white && m.tc == 6) { np.board[7][5] = np.board[7][7]; np.board[7][7] = '.'; }
        if (white && m.tc == 2) { np.board[7][3] = np.board[7][0]; np.board[7][0] = '.'; }
        if (!white && m.tc == 6) { np.board[0][5] = np.board[0][7]; np.board[0][7] = '.'; }
        if (!white && m.tc == 2) { np.board[0][3] = np.board[0][0]; np.board[0][0] = '.'; }
    }
    auto strip = [&](char flag) { size_t pos = np.castling.find(flag); if (pos != std::string::npos) np.castling.erase(pos, 1); };
    if (piece == 'K') { strip('K'); strip('Q'); }
    if (piece == 'k') { strip('k'); strip('q'); }
    if (piece == 'R' && m.fr == 7 && m.fc == 0) strip('Q');
    if (piece == 'R' && m.fr == 7 && m.fc == 7) strip('K');
    if (piece == 'r' && m.fr == 0 && m.fc == 0) strip('q');
    if (piece == 'r' && m.fr == 0 && m.fc == 7) strip('k');
    char captured = np.board[m.tr][m.tc];
    np.board[m.tr][m.tc] = m.promo ? (isWhite(piece) ? std::toupper(static_cast<unsigned char>(m.promo)) : std::tolower(static_cast<unsigned char>(m.promo))) : piece;
    np.board[m.fr][m.fc] = '.';
    np.ep = "-";
    if (std::tolower(static_cast<unsigned char>(piece)) == 'p' && std::abs(m.tr - m.fr) == 2) {
        int mid = (m.tr + m.fr) / 2;
        np.ep = std::string(1, char('a' + m.fc)) + std::to_string(8 - mid);
    }
    np.stm = white ? 'b' : 'w';
    if (!white) np.full++;
    np.half = (std::tolower(static_cast<unsigned char>(piece)) == 'p' || captured != '.') ? 0 : np.half + 1;
    if (np.castling.empty()) np.castling = "-";
    return np;
}

std::string nPlus1Tag(const Pos &p) {
    bool wk = false, bk = false;
    for (int r = 0; r < 8; r++) for (int c = 0; c < 8; c++) {
        if (p.board[r][c] == 'K') wk = true;
        if (p.board[r][c] == 'k') bk = true;
    }
    if (!wk && bk) return "own-king-missing";
    if (!bk && wk) return "opponent-king-missing";
    if (!wk && !bk) return "both-kings-missing";
    return "ok";
}

// Utility: locate king for side
std::pair<int,int> findKing(const Pos &p, bool white){
    for (int r=0;r<8;++r) for (int c=0;c<8;++c){
        if (white && p.board[r][c]=='K') return {r,c};
        if (!white && p.board[r][c]=='k') return {r,c};
    }
    return {-1,-1};
}

// Attack detector: are there attacks on (r,c) by the indicated color
bool squareAttackedBy(const Pos &p, int r, int c, bool byWhite, const Options &opt){
    Pos tmp = p; tmp.stm = byWhite? 'w':'b';
    Options o = opt; o.includeCastling = false; // castling isn't an attack pattern
    auto atks = genPseudo(tmp, o);
    for (const auto &m : atks) if (m.tr==r && m.tc==c) return true; return false;
}

// Legal moves from position p: pseudo then filtered by king-in-check after move
std::vector<Move> genLegal(const Pos &p, const Options &opt){
    std::vector<Move> legal;
    auto pseudo = genPseudo(p, opt);
    bool white = (p.stm=='w');
    for (const auto &m : pseudo){
        Pos np = applyMove(p, m);
        auto k = findKing(np, white);
        if (k.first<0) continue; // illegal if king missing
        if (squareAttackedBy(np, k.first, k.second, !white, opt)) continue; // leaves king in check
        legal.push_back(m);
    }
    return legal;
}

// Algebraic helpers
std::string rcToAlg(int r,int c){ return std::string(1, char('a'+c)) + std::to_string(8-r); }
bool algToRC(const std::string &sq, int &r, int &c){ if (sq.size()!=2) return false; c = sq[0]-'a'; int rank = sq[1]-'0'; r = 8-rank; return inBounds(r,c);} 

std::string moveToUci(const Move &m){ std::string s; s+=rcToAlg(m.fr,m.fc); s+=rcToAlg(m.tr,m.tc); if (m.promo) s+=char(std::tolower((unsigned char)m.promo)); return s; }
bool parseUci(const std::string &uci, Move &out){ if (uci.size()<4) return false; int fr,fc,tr,tc; if(!algToRC(uci.substr(0,2),fr,fc)) return false; if(!algToRC(uci.substr(2,2),tr,tc)) return false; out={fr,fc,tr,tc,0}; if (uci.size()>=5) out.promo = uci[4]; return true; }

Options parseOptionsJson(const char* json) {
    Options o;
    if (!json || !*json) return o;
    // naive tiny parser for flat JSON object with simple fields
    std::string s(json);
    auto findBool = [&](const char* key, bool &dst){
        auto p = s.find(std::string("\"") + key + "\"");
        if (p==std::string::npos) return;
        auto c = s.find(':', p); if (c==std::string::npos) return;
        auto val = s.substr(c+1);
        if (val.find("true",0) != std::string::npos) dst = true;
        else if (val.find("false",0) != std::string::npos) dst = false;
    };
    auto findInt = [&](const char* key, int &dst){
        auto p = s.find(std::string("\"") + key + "\"");
        if (p==std::string::npos) return;
        auto c = s.find(':', p); if (c==std::string::npos) return;
        dst = std::atoi(s.c_str()+c+1);
    };
    auto findStr = [&](const char* key, std::string &dst){
        auto p = s.find(std::string("\"") + key + "\"");
        if (p==std::string::npos) return;
        auto c = s.find(':', p); if (c==std::string::npos) return;
        auto q1 = s.find('"', c+1); if (q1==std::string::npos) return;
        auto q2 = s.find('"', q1+1); if (q2==std::string::npos) return;
        dst = s.substr(q1+1, q2-q1-1);
    };
    findBool("includeCastling", o.includeCastling);
    findBool("includeEnPassant", o.includeEnPassant);
    findBool("uniquePerPly", o.uniquePerPly);
    findBool("castleSafety", o.castleSafety);
    findInt("capPerParent", o.capPerParent);
    findStr("promotions", o.promotions);
    // sanitize promotions: keep only qrbn in lower
    std::string clean;
    for (char ch : o.promotions) {
        char l = std::tolower(static_cast<unsigned char>(ch));
        if (l=='q'||l=='r'||l=='b'||l=='n') clean.push_back(l);
    }
    if (!clean.empty()) o.promotions = clean; else o.promotions = "qrbn";
    return o;
}
}

extern "C" const char* generate_descendants(const char* fen, int depth, int enableNPlus1) {
    // Back-compat shim: call options variant with null options
    return generate_descendants_opts(fen, depth, enableNPlus1, nullptr);
}

extern "C" const char* generate_descendants_opts(const char* fen, int depth, int enableNPlus1, const char* optionsJson) {
    if (depth < 1) depth = 1;
    if (depth > 8) depth = 8;
    Pos root;
    if (!parseFEN(fen, root)) { g_lastJson = "{\"error\":\"bad fen\"}"; return g_lastJson.c_str(); }
    Options opt = parseOptionsJson(optionsJson);

    struct Node { std::string parent; std::string fen; int d; std::string n1; };
    std::vector<Node> nodes;
    std::vector<Pos> layer; layer.push_back(root);
    std::vector<std::pair<int,int>> plyCounts;
    int total = 0;

    for (int d = 0; d < depth; ++d) {
        std::vector<Pos> next;
        int gen = 0;
        std::unordered_set<std::string> uniq;
        for (const Pos &p : layer) {
            auto moves = genPseudo(p, opt);
            gen += (int)moves.size();
            for (const auto &mv : moves) {
                Pos child = applyMove(p, mv);
                std::string cf = toFEN(child);
                if (opt.uniquePerPly) {
                    if (!uniq.insert(cf).second) continue;
                }
                Node n{toFEN(p), cf, d + 1, ""};
                if (enableNPlus1 && d == depth - 1) {
                    auto m2 = genPseudo(child, opt);
                    Pos target = m2.empty() ? child : applyMove(child, m2[0]);
                    n.n1 = nPlus1Tag(target);
                }
                nodes.push_back(std::move(n));
                next.push_back(child);
            }
        }
        total += gen;
        plyCounts.push_back({d + 1, gen});
        if (next.empty()) break;
        layer.swap(next);
    }
    std::ostringstream out;
    out << "{\"root\":\"" << fen << "\",\"depth\":" << depth << ",\"nodes\":[";
    for (size_t i = 0; i < nodes.size(); ++i) {
        const auto &n = nodes[i];
        out << "{\"parent\":\"" << n.parent << "\",\"fen\":\"" << n.fen << "\",\"d\":" << n.d;
        if (!n.n1.empty()) out << ",\"n1\":\"" << n.n1 << "\"";
        out << "}"; if (i + 1 < nodes.size()) out << ",";
    }
    out << "],\"perf\":{\"totalNodes\":" << total << ",\"ply\":[";
    for (size_t i = 0; i < plyCounts.size(); ++i) {
        out << "{\"ply\":" << plyCounts[i].first << ",\"generated\":" << plyCounts[i].second << "}";
        if (i + 1 < plyCounts.size()) out << ",";
    }
    out << "]}}";
    g_lastJson = out.str();
    return g_lastJson.c_str();
}

// List legal moves as JSON: {"moves":[{"from":"e2","to":"e4","uci":"e2e4"}, ...]}
extern "C" const char* list_legal_moves(const char* fen, const char* fromSqOrNull, const char* optionsJson){
    Pos p; if (!parseFEN(fen, p)) { g_lastJson = "{\"error\":\"bad fen\"}"; return g_lastJson.c_str(); }
    Options opt = parseOptionsJson(optionsJson);
    auto legal = genLegal(p, opt);
    std::ostringstream out; out << "{\"moves\":[";
    bool first=true; int frFilter=-1, fcFilter=-1;
    if (fromSqOrNull && *fromSqOrNull){ std::string f(fromSqOrNull); algToRC(f, frFilter, fcFilter); }
    for (const auto &m : legal){
        if (frFilter>=0 && (m.fr!=frFilter || m.fc!=fcFilter)) continue;
        if (!first) out << ","; first=false;
        out << "{\"from\":\""<< rcToAlg(m.fr,m.fc) <<"\",\"to\":\""<< rcToAlg(m.tr,m.tc) <<"\",\"uci\":\""<< moveToUci(m) <<"\"";
        if (m.promo) out << ",\"promo\":\""<< char(std::tolower((unsigned char)m.promo)) <<"\"";
        out << "}";
    }
    out << "],\"stm\":\""<< p.stm <<"\"}";
    g_lastJson = out.str(); return g_lastJson.c_str();
}

// Apply a UCI move if legal; returns new FEN or {"error":"illegal"}
extern "C" const char* apply_move_if_legal(const char* fen, const char* uciMove, const char* optionsJson){
    Pos p; if (!parseFEN(fen, p)) { g_lastJson = "{\"error\":\"bad fen\"}"; return g_lastJson.c_str(); }
    Options opt = parseOptionsJson(optionsJson);
    Move wanted; if (!uciMove || !parseUci(uciMove, wanted)) { g_lastJson = "{\"error\":\"bad move\"}"; return g_lastJson.c_str(); }
    auto legal = genLegal(p, opt);
    for (const auto &m : legal){
        if (m.fr==wanted.fr && m.fc==wanted.fc && m.tr==wanted.tr && m.tc==wanted.tc && ((m.promo?std::tolower((unsigned char)m.promo):0) == (wanted.promo?std::tolower((unsigned char)wanted.promo):0))){
            Pos np = applyMove(p, m);
            g_lastJson = toFEN(np);
            return g_lastJson.c_str();
        }
    }
    g_lastJson = "{\"error\":\"illegal\"}"; return g_lastJson.c_str();
}

// Utility: expose side-to-move in-check as a C API for eval.cpp extensions
extern "C" int side_in_check(const char* fen){
    Pos p; if (!parseFEN(fen, p)) return 0;
    bool white = (p.stm=='w');
    auto k = findKing(p, white);
    if (k.first<0) return 0;
    Options opt; // defaults fine; castling not needed for attacks
    return squareAttackedBy(p, k.first, k.second, !white, opt) ? 1 : 0;
}
