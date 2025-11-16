#include "engine.h"
#include <string>
#include <unordered_map>
#include <mutex>
#include <cstdint>
#include <cstdlib>
#include <sstream>
#include <vector>
#include <functional>
#include <thread>
#include <atomic>
#include <condition_variable>
#include <random>
#include <chrono>

// =============================================================
// Symmetry-first evaluation (Iteration 1): 1-ply static scoring
// -------------------------------------------------------------
// We now provide a colorblind static evaluation and 1-ply child
// scoring:
// - evaluate_fen_colorblind: white-minus-black material, ignoring
//   side-to-move (colorblind), ensuring eva == -evb under flips.
// - score_children: for each legal child, compute its static eval
//   and report side-normalized aggregate (agg) and immediate delta
//   (imm). Nodes and actualPlies reflect 1-ply expansion.
// - choose_best_move: pick the child with maximum agg.
// -------------------------------------------------------------
// A lightweight position-depth cache remains for future deeper
// search integration.
// -------------------------------------------------------------
// Memory target: up to 10 GB (soft). We track approximate size and
// stop inserting new entries once exceeded. (Approximate since
// unordered_map overhead varies.)
// =============================================================

namespace {
struct CacheEntry { int maxDepth=0; };
static std::unordered_map<std::string, CacheEntry> g_cache;
static std::mutex g_cacheMutex;
static size_t g_estimatedBytes = 0;
static const size_t MAX_BYTES = size_t(10ull * 1024ull * 1024ull * 1024ull); // 10 GB

static std::string positionCacheKey(const char* fen){
    if(!fen) return {};
    // Key: board + side + castling + ep square (up to 4 spaces after board)
    std::string s(fen);
    // Simplicity: take everything up to halfmove clock (5th space) for uniqueness
    int spaces=0; size_t i=0; for(; i<s.size(); ++i){ if(s[i]==' ') { spaces++; if(spaces==5){ break; } } }
    return s.substr(0,i);
}

// -------------------- Transposition table (depth-scoped) --------------------
namespace {
struct TTEntry { int depth=0; int eval=0; std::string best; };
static std::unordered_map<std::string, TTEntry> g_tt;
static std::mutex g_ttMutex;

static std::string ttKey(const char* fen, int depth){ return positionCacheKey(fen) + "|d:" + std::to_string(depth); }

static bool ttProbe(const char* fen, int depth, int &outEval, std::string &outBest){
    std::lock_guard<std::mutex> lk(g_ttMutex);
    auto key = ttKey(fen, depth);
    auto it = g_tt.find(key);
    if(it==g_tt.end()) return false;
    outEval = it->second.eval; outBest = it->second.best; return true;
}
static void ttStore(const char* fen, int depth, int eval, const std::string &best){
    std::lock_guard<std::mutex> lk(g_ttMutex);
    auto key = ttKey(fen, depth);
    auto it = g_tt.find(key);
    if(it==g_tt.end()){
        size_t add = key.size() + sizeof(TTEntry) + best.size() + 64;
        if(g_estimatedBytes + add <= MAX_BYTES){ g_tt.emplace(key, TTEntry{depth, eval, best}); g_estimatedBytes += add; }
    } else {
        if(depth >= it->second.depth){ it->second.depth = depth; it->second.eval = eval; it->second.best = best; }
    }
}
}

// --------------------------- Search controller ------------------------------
namespace {
#if defined(__EMSCRIPTEN__) && defined(__EMSCRIPTEN_PTHREADS__)
// WASM with pthreads: async threaded search (same as native path)
struct SearchState {
    std::atomic<bool> running{false};
    std::atomic<bool> cancel{false};
    std::thread worker;
    std::mutex mu;
    std::string lastStatusJson; // latest status/result JSON
} g_search;
#elif defined(__EMSCRIPTEN__)
// WASM without pthreads: synchronous search fallback
struct SearchState {
    std::atomic<bool> running{false};
    std::mutex mu;
    std::string lastStatusJson; // latest status/result JSON
} g_search;
#else
// Native
struct SearchState {
    std::atomic<bool> running{false};
    std::atomic<bool> cancel{false};
    std::thread worker;
    std::mutex mu;
    std::string lastStatusJson; // latest status/result JSON
} g_search;
#endif
}

static void cacheRecord(const char* fen, int depth){
    std::lock_guard<std::mutex> lk(g_cacheMutex);
    auto key = positionCacheKey(fen);
    auto it = g_cache.find(key);
    if(it==g_cache.end()){
        // Rough per-entry size estimate
        size_t add = key.size() + sizeof(CacheEntry) + 64; // 64 bytes overhead fudge
        if(g_estimatedBytes + add > MAX_BYTES) return; // soft cap
        g_cache.emplace(key, CacheEntry{depth});
        g_estimatedBytes += add;
    } else if(depth > it->second.maxDepth){
        it->second.maxDepth = depth; // update depth only
    }
}

static int cachedMaxDepth(const char* fen){
    std::lock_guard<std::mutex> lk(g_cacheMutex);
    auto key = positionCacheKey(fen);
    auto it = g_cache.find(key);
    return (it==g_cache.end()) ? 0 : it->second.maxDepth;
}

// Basic JSON helper: escape quotes/backslashes minimally
static std::string jsonEscape(const std::string &in){
    std::string out; out.reserve(in.size()+8);
    for(char c: in){ if(c=='"' || c=='\\') out.push_back('\\'); out.push_back(c); }
    return out;
}

#ifdef ENGINE_EXPLAIN_MATH
struct MatCounts {
    int Pw=0,Nw=0,Bw=0,Rw=0,Qw=0; // kings scored 0, omit
    int pb=0,nb=0,bb=0,rb=0,qb=0;
    int W=0,B=0,total=0;
};

static MatCounts materialCountsFromFen(const char* fen){
    MatCounts mc; if(!fen) return mc;
    std::string s(fen); size_t sp = s.find(' ');
    std::string placement = (sp==std::string::npos)? s : s.substr(0, sp);
    for(char ch: placement){
        if(ch=='/' || (ch>='1' && ch<='8')) continue;
        switch(ch){
            case 'P': mc.Pw++; mc.W+=100; break; case 'p': mc.pb++; mc.B+=100; break;
            case 'N': mc.Nw++; mc.W+=300; break; case 'n': mc.nb++; mc.B+=300; break;
            case 'B': mc.Bw++; mc.W+=300; break; case 'b': mc.bb++; mc.B+=300; break;
            case 'R': mc.Rw++; mc.W+=500; break; case 'r': mc.rb++; mc.B+=500; break;
            case 'Q': mc.Qw++; mc.W+=900; break; case 'q': mc.qb++; mc.B+=900; break;
            default: break; // K/k score 0
        }
    }
    mc.total = mc.W - mc.B;
    return mc;
}

static std::string materialFormulaString(const MatCounts& mc, const char* label){
    std::ostringstream os;
    os << (label?label:"base") << " material (white-minus-black)\n";
    os << "W = 100*"<<mc.Pw<<" + 300*"<<mc.Nw<<" + 300*"<<mc.Bw<<" + 500*"<<mc.Rw<<" + 900*"<<mc.Qw<<" = "<< mc.W <<"\n";
    os << "B = 100*"<<mc.pb<<" + 300*"<<mc.nb<<" + 300*"<<mc.bb<<" + 500*"<<mc.rb<<" + 900*"<<mc.qb<<" = "<< mc.B <<"\n";
    os << "Total = W - B = "<< mc.W <<" - "<< mc.B <<" = "<< mc.total;
    return os.str();
}
#endif

// Extract UCI move strings from list_legal_moves JSON (very simple pattern scan)
static std::vector<std::string> extractUcis(const std::string &s){
    std::vector<std::string> out; size_t pos=0; const std::string pat="\"uci\":\"";
    while((pos=s.find(pat,pos))!=std::string::npos){ size_t start=pos+pat.size(); size_t end=s.find('"', start); if(end==std::string::npos) break; out.push_back(s.substr(start, end-start)); pos=end+1; }
    return out;
}

// Tiny options parsing helpers (naive substring scans)
static int parseIntOption(const char* json, const char* key, int defVal){
    if(!json||!*json||!key) return defVal; std::string s(json), k(key);
    size_t p = s.find(k); if(p==std::string::npos) return defVal; p = s.find(':', p); if(p==std::string::npos) return defVal; ++p; while(p<s.size() && std::isspace((unsigned char)s[p])) ++p; bool neg=false; if(p<s.size()&&(s[p]=='-'||s[p]=='+')){ neg=(s[p]=='-'); ++p; }
    long v=0; bool any=false; while(p<s.size() && std::isdigit((unsigned char)s[p])){ any=true; v=v*10+(s[p]-'0'); ++p; }
    if(!any) return defVal; return (int)(neg? -v : v);
}
static bool parseBoolOption(const char* json, const char* key, bool defVal){
    if(!json||!*json||!key) return defVal; std::string s(json), k(key);
    size_t p = s.find(k); if(p==std::string::npos) return defVal; p = s.find(':', p); if(p==std::string::npos) return defVal; ++p; while(p<s.size() && std::isspace((unsigned char)s[p])) ++p;
    if(s.compare(p,4,"true")==0) return true; if(s.compare(p,5,"false")==0) return false; return defVal;
}

// Fen helpers
static char fenSideToMove(const char* fen){ if(!fen) return 'w'; std::string s(fen); size_t sp=s.find(' '); return (sp!=std::string::npos && sp+1<s.size())? s[sp+1] : 'w'; }
}

extern "C" int side_in_check(const char*);

// --------------------- Global RNG (configurable seed) ----------------------
namespace {
static std::mt19937 g_rng{12345};
static std::atomic<int> g_rng_seed{12345};
}

extern "C" void set_engine_random_seed(int seed){
    if(seed==0){
        seed = (int)std::chrono::high_resolution_clock::now().time_since_epoch().count();
    }
    g_rng.seed(seed);
    g_rng_seed.store(seed);
}

extern "C" int evaluate_fen_opts(const char* fen, const char* optionsJson){
    (void)fen; (void)optionsJson; // iteration 0: always 0
    return 0;
}

namespace {
// Parse FEN placement and return white-minus-black material.
// King is scored 0 for evaluation; no positional terms yet.
static int pieceValue(char p){
    switch(p){
        case 'P': return 100; case 'p': return -100;
        case 'N': return 300; case 'n': return -300;
        case 'B': return 300; case 'b': return -300;
        case 'R': return 500; case 'r': return -500;
        case 'Q': return 900; case 'q': return -900;
        case 'K': return 0;   case 'k': return 0;
        default: return 0;
    }
}
static int evaluate_white_minus_black_material(const char* fen){
    if(!fen) return 0;
    // Extract placement field (before first space)
    std::string s(fen);
    size_t sp = s.find(' ');
    std::string placement = (sp==std::string::npos)? s : s.substr(0, sp);
    int eval = 0; int fileCount = 0;
    for(char ch: placement){
        if(ch=='/') { fileCount = 0; continue; }
        if(ch>='1' && ch<='8'){ int n = ch-'0'; fileCount += n; continue; }
        eval += pieceValue(ch); fileCount++;
    }
    (void)fileCount; // not used beyond basic validation
    return eval;
}
}

extern "C" int evaluate_fen_colorblind(const char* fen, const char* optionsJson){
    (void)optionsJson;
    // Colorblind: ignore side-to-move; return white-minus-black material
    // so that rotating+swapping yields negation as required by tests.
    return evaluate_white_minus_black_material(fen);
}

extern "C" const char* evaluate_move_line(const char* fen, const char* movesJson, const char* optionsJson){
    (void)movesJson; (void)optionsJson;
    static std::string g; std::string f = fen?fen:"";
    g = std::string("{\"start\":\"") + jsonEscape(f) + "\",\"nodes\":[],\"finalFen\":\"" + jsonEscape(f) + "\",\"finalEval\":0}";
    return g.c_str();
}

extern "C" const char* choose_best_move(const char* fen, const char* optionsJson){
    static std::string g;
    if(!fen || !*fen){ g = "{\"error\":\"no-fen\"}"; return g.c_str(); }
    extern const char* list_legal_moves(const char*, const char*, const char*);
    extern const char* apply_move_if_legal(const char*, const char*, const char*);
    // Enforce colorblind: engine must only be asked for white to move
    if(fenSideToMove(fen) == 'b'){
        // Hard fail as illegal input; this is production behavior
        g = "{\"error\":\"illegal-input: black-to-move not allowed\"}";
        return g.c_str();
    }
    const char* movesJson = list_legal_moves(fen, nullptr, optionsJson);
    if(!movesJson || !*movesJson){ g = "{\"error\":\"no-moves\"}"; return g.c_str(); }
    std::vector<std::string> ucis = extractUcis(std::string(movesJson));
    if(ucis.empty()){
        // Always produce a structured (empty) JSON rather than leaving string blank.
        int baseEvalTmp = evaluate_white_minus_black_material(fen);
        char sideTmp = fenSideToMove(fen);
        int normBase = (sideTmp=='w')? baseEvalTmp : -baseEvalTmp;
        g = std::string("{\"depth\":1,\"best\":{\"uci\":\"\",\"score\":") + std::to_string(normBase) + ",\"imm\":0,\"nodes\":0,\"actualPlies\":1,\"pv\":[]} ,\"candidates\":[],\"baseEval\":" + std::to_string(normBase) + "}";
        return g.c_str();
    }

    // Depth and extension options
    int maxDepth = parseIntOption(optionsJson, "searchDepth", 1);
    if(maxDepth<1) maxDepth = 1; // no upper clamp
    bool extOnCap = parseBoolOption(optionsJson, "extendOnCapture", true);
    bool dbgFlag = parseBoolOption(optionsJson, "debugNegamax", false);
    bool extOnChk = parseBoolOption(optionsJson, "extendOnCheck", false); (void)extOnChk; // placeholder
    bool colorblindSearch = parseBoolOption(optionsJson, "colorblindSearch", true);

    // Base evaluation (colorblind, side-agnostic)
    int baseEval = evaluate_white_minus_black_material(fen);
    char side = fenSideToMove(fen);
    int bestScore = -10000000; // maximizing normalized score
    std::string best = ucis.front();
    std::ostringstream cand; bool first=true;

    // Minimal negamax with (optional) single-ply capture and check extensions
    
    // Quiescence: extend captures to achieve material stability (no alpha-beta yet for simplicity)
    std::function<int(const char*, int, int, int)> qsearch = [&](const char* posFen, int depthLimit, int alpha, int beta){
        char s = fenSideToMove(posFen);
        int stand = evaluate_white_minus_black_material(posFen);
        int standNorm = (s=='w') ? stand : -stand;
        if(standNorm >= beta) return standNorm;
        if(standNorm > alpha) alpha = standNorm;
        if(depthLimit <= 0) return standNorm;
        const char* childList = list_legal_moves(posFen, nullptr, optionsJson);
        if(!childList) return standNorm;
        std::vector<std::string> moves = extractUcis(std::string(childList));
        if(moves.empty()) return standNorm;
        int base = evaluate_white_minus_black_material(posFen);
        for(const auto &mv: moves){
#if !defined(__EMSCRIPTEN__) || defined(__EMSCRIPTEN_PTHREADS__)
            if(g_search.cancel.load()) break;
#endif
            const char* nfC = apply_move_if_legal(posFen, mv.c_str(), optionsJson);
            std::string nfStr = nfC ? std::string(nfC) : std::string(posFen);
            int childE = evaluate_white_minus_black_material(nfStr.c_str());
            bool isCap = (childE != base); // material changed -> capture or promotion
            if(!isCap) continue; // only captures in quiescence
            int score = -qsearch(nfStr.c_str(), depthLimit-1, -beta, -alpha);
            if(score >= beta) return score;
            if(score > alpha) alpha = score;
        }
        return alpha;
    };

    // Negamax with simple alpha-beta and quiescence at depth==0.
    std::function<int(const char*,int,bool,int,int)> negamax = [&](const char* posFen, int depth, bool extAvail, int alpha, int beta){
        char s = fenSideToMove(posFen);
#if !defined(__EMSCRIPTEN__) || defined(__EMSCRIPTEN_PTHREADS__)
        if((depth > 0) && g_search.cancel.load()) return 0;
#endif
        if(depth <= 0){
            // Quiescence depth limit chosen small to avoid runaway (captures only)
            return qsearch(posFen, 8, alpha, beta);
        }
        int tte; std::string ttb; if(ttProbe(posFen, depth, tte, ttb)) return tte;
        const char* childList = list_legal_moves(posFen, nullptr, optionsJson);
        if(!childList){
            int stand = evaluate_white_minus_black_material(posFen);
            return (s=='w') ? stand : -stand;
        }
        std::vector<std::string> moves = extractUcis(std::string(childList));
        if(moves.empty()){
            int stand = evaluate_white_minus_black_material(posFen);
            return (s=='w') ? stand : -stand;
        }
        int base = evaluate_white_minus_black_material(posFen);
        int bestN = -10000000; std::string bestLocal;
        for(const auto &mv: moves){
#if !defined(__EMSCRIPTEN__) || defined(__EMSCRIPTEN_PTHREADS__)
            if(g_search.cancel.load()) break;
#endif
            const char* nfC = apply_move_if_legal(posFen, mv.c_str(), optionsJson);
            std::string nfStr = nfC ? std::string(nfC) : std::string(posFen);
            int childE = evaluate_white_minus_black_material(nfStr.c_str());
            bool isCap = (childE != base);
            int childDepth = depth - 1;
            bool usedExt=false;
            if(extAvail && extOnCap && isCap){ childDepth += 1; usedExt = true; }
            if(extAvail && !usedExt && extOnChk && nfC && side_in_check(nfStr.c_str())){ childDepth += 1; usedExt = true; }
            bool nextExtAvail = extAvail && !usedExt;
            int score = -negamax(nfStr.c_str(), childDepth, nextExtAvail, -beta, -alpha);
            if(score > bestN){ bestN = score; bestLocal = mv; }
            if(score > alpha) alpha = score;
            if(alpha >= beta) break; // prune
        }
        ttStore(posFen, depth, bestN, bestLocal);
        return bestN;
    };

    // Colorblind max-search (always maximize white-minus-black eval; no sign flips)
    std::function<int(const char*, int, int, int)> qsearch_cb = [&](const char* posFen, int depthLimit, int alpha, int beta){
        int stand = evaluate_white_minus_black_material(posFen);
        if(stand >= beta) return stand;
        if(stand > alpha) alpha = stand;
        if(depthLimit <= 0) return stand;
        const char* childList = list_legal_moves(posFen, nullptr, optionsJson);
        if(!childList) return stand;
        std::vector<std::string> moves = extractUcis(std::string(childList));
        if(moves.empty()) return stand;
        int base = evaluate_white_minus_black_material(posFen);
        for(const auto &mv: moves){
#if !defined(__EMSCRIPTEN__) || defined(__EMSCRIPTEN_PTHREADS__)
            if(g_search.cancel.load()) break;
#endif
            const char* nfC = apply_move_if_legal(posFen, mv.c_str(), optionsJson);
            std::string nfStr = nfC ? std::string(nfC) : std::string(posFen);
            int childE = evaluate_white_minus_black_material(nfStr.c_str());
            bool isCap = (childE != base);
            if(!isCap) continue;
            int score = qsearch_cb(nfStr.c_str(), depthLimit-1, alpha, beta);
            if(score >= beta) return score;
            if(score > alpha) alpha = score;
        }
        return alpha;
    };
    std::function<int(const char*, int, int, int)> maxsearch_cb = [&](const char* posFen, int depth, int alpha, int beta){
#if !defined(__EMSCRIPTEN__) || defined(__EMSCRIPTEN_PTHREADS__)
        if((depth > 0) && g_search.cancel.load()) return 0;
#endif
        if(depth <= 0){ return qsearch_cb(posFen, 8, alpha, beta); }
        int tte; std::string ttb; if(ttProbe(posFen, depth, tte, ttb)) return tte;
        const char* childList = list_legal_moves(posFen, nullptr, optionsJson);
        int stand = evaluate_white_minus_black_material(posFen);
        if(!childList) return stand;
        std::vector<std::string> moves = extractUcis(std::string(childList));
        if(moves.empty()) return stand;
        int bestN = -10000000; std::string bestLocal;
        for(const auto &mv: moves){
#if !defined(__EMSCRIPTEN__) || defined(__EMSCRIPTEN_PTHREADS__)
            if(g_search.cancel.load()) break;
#endif
            const char* nfC = apply_move_if_legal(posFen, mv.c_str(), optionsJson);
            std::string nfStr = nfC ? std::string(nfC) : std::string(posFen);
            int score = maxsearch_cb(nfStr.c_str(), depth-1, alpha, beta);
            if(score > bestN){ bestN = score; bestLocal = mv; }
            if(score > alpha) alpha = score;
            if(alpha >= beta) break;
        }
        ttStore(posFen, depth, bestN, bestLocal);
        return bestN;
    };

    // Collect per-move data; apply random tie-break among max agg moves
    std::vector<int> aggVals; aggVals.reserve(ucis.size());
    std::vector<int> immVals; immVals.reserve(ucis.size());
    std::vector<std::string> pvSingle; pvSingle.reserve(ucis.size());
    for(const auto &m: ucis){
        const char* nextFen = apply_move_if_legal(fen, m.c_str(), optionsJson);
        int childEval = evaluate_white_minus_black_material(nextFen ? nextFen : fen);
        int agg;
        if(colorblindSearch){
            agg = (maxDepth<=1) ? childEval : maxsearch_cb(nextFen?nextFen:fen, maxDepth-1, -10000000, 10000000);
        } else {
            if(maxDepth<=1){
                agg = (side=='w') ? childEval : -childEval;
            } else {
                agg = -negamax(nextFen?nextFen:fen, maxDepth-1, true, -10000000, 10000000);
            }
        }
        int imm = (childEval - baseEval);
        aggVals.push_back(agg); immVals.push_back(imm); pvSingle.push_back(m);
        if(agg > bestScore){ bestScore = agg; best = m; }
    }
    // Random tie-break among moves whose agg == bestScore
    std::vector<int> tieIdx; for(size_t i=0;i<aggVals.size();++i){ if(aggVals[i]==bestScore) tieIdx.push_back((int)i); }
    if(tieIdx.size()>1){ std::uniform_int_distribution<int> dist(0,(int)tieIdx.size()-1); int chosen = tieIdx[dist(g_rng)]; best = ucis[chosen]; }
    for(size_t i=0;i<ucis.size();++i){
        if(!first) cand << ","; first=false;
        cand << "{\"uci\":\"" << jsonEscape(ucis[i]) << "\",\"agg\":" << aggVals[i] << ",\"imm\":" << immVals[i] << ",\"nodes\":1,\"actualPlies\":" << maxDepth << ",\"pv\":[\"" << jsonEscape(pvSingle[i]) << "\"]";
        if(dbgFlag){ cand << ",\"dbg\":{\"base\":" << (colorblindSearch ? baseEval : ((side=='w')? baseEval : -baseEval)) << "}}"; }
        else { cand << "}"; }
    }
    // Record cache depth (ply 1)
    cacheRecord(fen, maxDepth);

#ifdef ENGINE_EXPLAIN_MATH
    // Build mathematical explanation for chosen move
    const char* nfBest = apply_move_if_legal(fen, best.c_str(), optionsJson);
    MatCounts baseC = materialCountsFromFen(fen);
    MatCounts childC = materialCountsFromFen(nfBest ? nfBest : fen);
    int immBest = childC.total - baseC.total;
    std::ostringstream math;
    math << materialFormulaString(baseC, "base") << "\n\n";
    std::string childLabel = std::string("child after ") + best;
    math << materialFormulaString(childC, childLabel.c_str()) << "\n\n";
    math << "Immediate delta = child - base = " << childC.total << " - " << baseC.total << " = " << immBest << "\n";
    if(maxDepth>1){ math << "Aggregate (search depth "<< maxDepth << ") score = " << bestScore << " (may include deeper tactics)"; }
    std::string mathEsc = jsonEscape(math.str());
    g = std::string("{\"depth\":") + std::to_string(maxDepth)
        + ",\"best\":{\"uci\":\"" + jsonEscape(best) + "\",\"score\":" + std::to_string(bestScore)
        + ",\"imm\":" + std::to_string(immBest) + ",\"nodes\":1,\"actualPlies\":" + std::to_string(maxDepth) + ",\"pv\":[\"" + jsonEscape(best) + "\"]}"
        + ",\"candidates\":[" + cand.str() + "]"
        + ",\"baseEval\":" + std::to_string(colorblindSearch ? baseEval : ((side=='w')? baseEval : -baseEval))
        + ",\"explain\":{\"type\":\"material\",\"math\":\"" + mathEsc + "\"}}";
#else
    g = std::string("{\"depth\":") + std::to_string(maxDepth) + ",\"best\":{\"uci\":\"" + jsonEscape(best) + "\",\"score\":" + std::to_string(bestScore) + ",\"imm\":0,\"nodes\":1,\"actualPlies\":" + std::to_string(maxDepth) + ",\"pv\":[\"" + jsonEscape(best) + "\"]},\"candidates\":[" + cand.str() + "],\"baseEval\":" + std::to_string(colorblindSearch ? baseEval : ((side=='w')? baseEval : -baseEval)) + "}";
#endif
    return g.c_str();
}

extern "C" const char* score_children(const char* fen, const char* optionsJson){
    static std::string g;
    if(!fen || !*fen){ g = "{\"error\":\"no-fen\"}"; return g.c_str(); }
    if(fenSideToMove(fen) == 'b'){
        g = "{\"error\":\"illegal-input: black-to-move not allowed\"}";
        return g.c_str();
    }
    extern const char* list_legal_moves(const char*, const char*, const char*);
    extern const char* apply_move_if_legal(const char*, const char*, const char*);
    const char* movesJson = list_legal_moves(fen, nullptr, optionsJson);
    if(!movesJson){ g = "{\"error\":\"no-moves\"}"; return g.c_str(); }
    std::vector<std::string> ucis = extractUcis(std::string(movesJson));
    int baseEval = evaluate_white_minus_black_material(fen);
    char side = fenSideToMove(fen);
    int maxDepth = parseIntOption(optionsJson, "searchDepth", 1); if(maxDepth<1) maxDepth=1; // no upper clamp
    bool extOnCap = parseBoolOption(optionsJson, "extendOnCapture", true);
    bool extOnChk = parseBoolOption(optionsJson, "extendOnCheck", false); (void)extOnChk;
    bool dbgFlag = parseBoolOption(optionsJson, "debugNegamax", false);
    bool colorblindSearch = parseBoolOption(optionsJson, "colorblindSearch", true);

    
    // Quiescence for this function scope
    std::function<int(const char*, int, int, int)> qsearch = [&](const char* posFen, int depthLimit, int alpha, int beta){
        char sQ = fenSideToMove(posFen);
        int stand = evaluate_white_minus_black_material(posFen);
        int standNorm = (sQ=='w') ? stand : -stand;
        if(standNorm >= beta) return standNorm;
        if(standNorm > alpha) alpha = standNorm;
        if(depthLimit <= 0) return standNorm;
        const char* childList = list_legal_moves(posFen, nullptr, optionsJson);
        if(!childList) return standNorm; std::vector<std::string> moves = extractUcis(std::string(childList)); if(moves.empty()) return standNorm;
        int baseQ = evaluate_white_minus_black_material(posFen);
        for(const auto &mv: moves){
#if !defined(__EMSCRIPTEN__) || defined(__EMSCRIPTEN_PTHREADS__)
            if(g_search.cancel.load()) break;
#endif
            const char* nfC = apply_move_if_legal(posFen, mv.c_str(), optionsJson);
            std::string nfStr = nfC ? std::string(nfC) : std::string(posFen);
            int childE = evaluate_white_minus_black_material(nfStr.c_str());
            bool isCap = (childE != baseQ);
            if(!isCap) continue;
            int score = -qsearch(nfStr.c_str(), depthLimit-1, -beta, -alpha);
            if(score >= beta) return score;
            if(score > alpha) alpha = score;
        }
        return alpha;
    };
    std::function<int(const char*,int,bool,int,int)> negamax = [&](const char* posFen, int depth, bool extAvail, int alpha, int beta){
        char s = fenSideToMove(posFen);
#if !defined(__EMSCRIPTEN__) || defined(__EMSCRIPTEN_PTHREADS__)
        if((depth > 0) && g_search.cancel.load()) return 0;
#endif
        if(depth<=0){ return qsearch(posFen, 8, alpha, beta); }
        int tte; std::string ttb; if(ttProbe(posFen, depth, tte, ttb)) return tte;
        const char* childList = list_legal_moves(posFen, nullptr, optionsJson);
        if(!childList){ int stand=evaluate_white_minus_black_material(posFen); return (s=='w')?stand:-stand; }
        std::vector<std::string> moves = extractUcis(std::string(childList)); if(moves.empty()){ int stand=evaluate_white_minus_black_material(posFen); return (s=='w')?stand:-stand; }
        int base = evaluate_white_minus_black_material(posFen);
        int bestN = -10000000; std::string bestLocal;
        for(const auto &mv: moves){
#if !defined(__EMSCRIPTEN__) || defined(__EMSCRIPTEN_PTHREADS__)
            if(g_search.cancel.load()) break;
#endif
            const char* nfC = apply_move_if_legal(posFen, mv.c_str(), optionsJson);
            std::string nfStr = nfC ? std::string(nfC) : std::string(posFen);
            int childE = evaluate_white_minus_black_material(nfStr.c_str());
            bool isCap = (childE != base);
            int childDepth = depth-1; bool usedExt=false;
            if(extAvail && extOnCap && isCap){ childDepth += 1; usedExt=true; }
            if(extAvail && !usedExt && extOnChk && nfC && side_in_check(nfStr.c_str())){ childDepth += 1; usedExt=true; }
            bool nextExtAvail = extAvail && !usedExt;
            int score = -negamax(nfStr.c_str(), childDepth, nextExtAvail, -beta, -alpha);
            if(score > bestN){ bestN = score; bestLocal = mv; }
            if(score > alpha) alpha = score;
            if(alpha >= beta) break;
        }
        ttStore(posFen, depth, bestN, bestLocal); return bestN;
    };

    // Colorblind max-search variant
    std::function<int(const char*, int, int, int)> qsearch_cb = [&](const char* posFen, int depthLimit, int alpha, int beta){
        int stand = evaluate_white_minus_black_material(posFen);
        if(stand >= beta) return stand;
        if(stand > alpha) alpha = stand;
        if(depthLimit <= 0) return stand;
        const char* childList = list_legal_moves(posFen, nullptr, optionsJson);
        if(!childList) return stand; std::vector<std::string> moves = extractUcis(std::string(childList)); if(moves.empty()) return stand;
        int baseQ = evaluate_white_minus_black_material(posFen);
        for(const auto &mv: moves){
#if !defined(__EMSCRIPTEN__) || defined(__EMSCRIPTEN_PTHREADS__)
            if(g_search.cancel.load()) break;
#endif
            const char* nfC = apply_move_if_legal(posFen, mv.c_str(), optionsJson);
            std::string nfStr = nfC ? std::string(nfC) : std::string(posFen);
            int childE = evaluate_white_minus_black_material(nfStr.c_str());
            bool isCap = (childE != baseQ);
            if(!isCap) continue;
            int score = qsearch_cb(nfStr.c_str(), depthLimit-1, alpha, beta);
            if(score >= beta) return score;
            if(score > alpha) alpha = score;
        }
        return alpha;
    };
    std::function<int(const char*, int, int, int)> maxsearch_cb = [&](const char* posFen, int depth, int alpha, int beta){
#if !defined(__EMSCRIPTEN__) || defined(__EMSCRIPTEN_PTHREADS__)
        if((depth > 0) && g_search.cancel.load()) return 0;
#endif
        if(depth<=0){ return qsearch_cb(posFen, 8, alpha, beta); }
        int tte; std::string ttb; if(ttProbe(posFen, depth, tte, ttb)) return tte;
        const char* childList = list_legal_moves(posFen, nullptr, optionsJson);
        int stand = evaluate_white_minus_black_material(posFen);
        if(!childList) return stand; std::vector<std::string> moves = extractUcis(std::string(childList)); if(moves.empty()) return stand;
        int bestN = -10000000; std::string bestLocal;
        for(const auto &mv: moves){
#if !defined(__EMSCRIPTEN__) || defined(__EMSCRIPTEN_PTHREADS__)
            if(g_search.cancel.load()) break;
#endif
            const char* nfC = apply_move_if_legal(posFen, mv.c_str(), optionsJson);
            std::string nfStr = nfC ? std::string(nfC) : std::string(posFen);
            int score = maxsearch_cb(nfStr.c_str(), depth-1, alpha, beta);
            if(score > bestN){ bestN = score; bestLocal = mv; }
            if(score > alpha) alpha = score;
            if(alpha >= beta) break;
        }
        ttStore(posFen, depth, bestN, bestLocal); return bestN;
    };

    std::ostringstream out; out << "{\"parent\":\"" << jsonEscape(fen?fen:"") << "\",\"depth\":"<< maxDepth << ",\"seed\":" << g_rng_seed.load() << ",\"children\":[";
    bool first=true; for(const auto &m: ucis){
        const char* nextFen = apply_move_if_legal(fen, m.c_str(), optionsJson);
        int childEval = evaluate_white_minus_black_material(nextFen ? nextFen : fen);
        int agg = colorblindSearch
            ? ((maxDepth<=1) ? childEval : maxsearch_cb(nextFen?nextFen:fen, maxDepth-1, -10000000, 10000000))
            : ((maxDepth<=1) ? ((side=='w') ? childEval : -childEval) : -negamax(nextFen?nextFen:fen, maxDepth-1, true, -10000000, 10000000));
        int imm = (childEval - baseEval);
        if(!first) out<<","; first=false;
        out << "{\"uci\":\""<< jsonEscape(m) << "\",\"agg\":"<< agg << ",\"imm\":"<< imm << ",\"nodes\":1,\"actualPlies\":"<< maxDepth << ",\"fen\":\""<< jsonEscape(nextFen?nextFen:"") << "\",\"pv\":[\""<< jsonEscape(m) << "\"]";
        if(dbgFlag){
            out << ",\"dbg\":{\"rootSide\":\"" << (side=='w'?"w":"b") << "\",\"base\":" << (colorblindSearch ? baseEval : ((side=='w')? baseEval : -baseEval)) << ",\"childEval\":" << (colorblindSearch ? childEval : ((side=='w')? childEval : -childEval)) << "}";
        }
        out << "}";
    }
    out << "],\"nodes\":" << ucis.size() << ",\"baseEval\":" << (colorblindSearch ? baseEval : ((side=='w')? baseEval : -baseEval)) << "}";
    g = out.str();
    return g.c_str();
}

// -------------------------- Async search API -------------------------------
#if defined(__EMSCRIPTEN__) && !defined(__EMSCRIPTEN_PTHREADS__)
extern "C" const char* start_search(const char* fen, const char* optionsJson){
    static std::string ack;
    if(!fen || !*fen){ ack = "{\"error\":\"no-fen\"}"; return ack.c_str(); }
    int maxDepth = parseIntOption(optionsJson, "searchDepth", 1); if(maxDepth<1) maxDepth=1; // no upper clamp
    std::string rootFen = fen; std::string opts = optionsJson? optionsJson: "{}";
    g_search.running.store(true);
    // Synchronous compute on main thread (no pthreads)
    const char* status = choose_best_move(rootFen.c_str(), opts.c_str());
    {
        std::lock_guard<std::mutex> lk(g_search.mu);
        g_search.lastStatusJson = status ? status : "{\"error\":\"status-null\"}";
    }
    g_search.running.store(false);
    ack = std::string("{\"ok\":true,\"running\":false,\"depth\":") + std::to_string(maxDepth) + "}";
    return ack.c_str();
}

extern "C" void cancel_search(){
    // Nothing to cancel in synchronous mode; ensure running=false
    g_search.running.store(false);
}

extern "C" const char* get_search_status(){
    static std::string s;
    std::lock_guard<std::mutex> lk(g_search.mu);
    s = std::string("{\"running\":") + (g_search.running.load()?"true":"false") + ",\"status\":" + (g_search.lastStatusJson.empty()? "{}" : g_search.lastStatusJson) + "}";
    return s.c_str();
}
#else
extern "C" const char* start_search(const char* fen, const char* optionsJson){
    static std::string ack;
    if(!fen || !*fen){ ack = "{\"error\":\"no-fen\"}"; return ack.c_str(); }
    // Cancel previous if running
    if(g_search.running.load()){ g_search.cancel.store(true); if(g_search.worker.joinable()) g_search.worker.join(); g_search.running.store(false); g_search.cancel.store(false); }
    // Snapshot options
    int maxDepth = parseIntOption(optionsJson, "searchDepth", 1); if(maxDepth<1) maxDepth=1; // no upper clamp
    bool extOnCap = parseBoolOption(optionsJson, "extendOnCapture", true);
    bool extOnChk = parseBoolOption(optionsJson, "extendOnCheck", false);
    std::string rootFen = fen; std::string opts = optionsJson? optionsJson: "{}";
    g_search.running.store(true); g_search.cancel.store(false);
    // Launch worker
    g_search.worker = std::thread([rootFen, opts, maxDepth, extOnCap, extOnChk]{
        // Reuse choose_best_move logic to compute candidates and best
        const char* status = choose_best_move(rootFen.c_str(), opts.c_str());
        {
            std::lock_guard<std::mutex> lk(g_search.mu);
            g_search.lastStatusJson = status ? status : "{\"error\":\"status-null\"}";
        }
        g_search.running.store(false);
    });
    ack = std::string("{\"ok\":true,\"running\":true,\"depth\":") + std::to_string(maxDepth) + "}";
    return ack.c_str();
}

extern "C" void cancel_search(){
    if(g_search.running.load()){
        g_search.cancel.store(true);
        if(g_search.worker.joinable()) g_search.worker.join();
        g_search.running.store(false);
        g_search.cancel.store(false);
    }
}

extern "C" const char* get_search_status(){
    static std::string s;
    std::lock_guard<std::mutex> lk(g_search.mu);
    if(g_search.running.load()){
        s = std::string("{\"running\":true,\"status\":") + (g_search.lastStatusJson.empty()? "{}" : g_search.lastStatusJson) + "}";
    } else {
        s = std::string("{\"running\":false,\"status\":") + (g_search.lastStatusJson.empty()? "{}" : g_search.lastStatusJson) + "}";
    }
    return s.c_str();
}
#endif

// Accessor for testing cache depth (not exported via headers yet).
extern "C" int debug_cached_depth(const char* fen){ return cachedMaxDepth(fen); }
