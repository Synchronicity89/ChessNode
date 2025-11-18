#include "engine.hpp"
#include "nnue.hpp"
#include <cstring>
#include <array>
#include <algorithm>
#include <sstream>
#if defined(_MSC_VER)
#include <intrin.h>
#endif
#include <immintrin.h> // AVX2 intrinsics header

namespace engine {

static const int pieceValue[6] = {100, 320, 330, 500, 900, 0}; // p n b r q k

// Precomputed pawn attack masks (white & black)
static std::array<uint64_t,64> pawnAttW{};
static std::array<uint64_t,64> pawnAttB{};
static std::array<uint64_t,64> knightMask{};
static std::array<uint64_t,64> kingMask{};
// Slider attack infrastructure
#ifdef USE_PEXT_TABLES
// PEXT-style exhaustive blocker enumeration (stable, portable)
static std::array<uint64_t,64> rookMask{};
static std::array<uint64_t,64> bishopMask{};
static std::array<int,64> rookBits{};
static std::array<int,64> bishopBits{};
static std::array<int,64> rookOffset{};
static std::array<int,64> bishopOffset{};
static std::array<unsigned char,64*14> rookBitPos{};   // up to 14 inner squares
static std::array<unsigned char,64*13> bishopBitPos{}; // up to 13 inner squares
static std::vector<uint64_t> rookTable;
static std::vector<uint64_t> bishopTable;
#else
// Magic bitboards (default). Classic preselected magic numbers.
static std::array<uint64_t,64> rookMagicMask{};
static std::array<uint64_t,64> bishopMagicMask{};
static std::array<int,64> rookMagicShift{};
static std::array<int,64> bishopMagicShift{};
static std::array<uint64_t,64> rookMagic{};
static std::array<uint64_t,64> bishopMagic{};
static std::array<int,64> rookMagicOffset{};
static std::array<int,64> bishopMagicOffset{};
static std::vector<uint64_t> rookMagicTable; // concatenated tables
static std::vector<uint64_t> bishopMagicTable;
#endif
static bool masksInit = false;

inline uint64_t bb(int sq) { return 1ULL << sq; }

static inline int lsb_index(uint64_t x) {
#if defined(_MSC_VER)
    unsigned long idx;
    _BitScanForward64(&idx, x);
    return (int)idx;
#else
    return __builtin_ctzll(x);
#endif
}

static inline int popcount64(uint64_t x) {
#if defined(_MSC_VER)
    return (int)__popcnt64(x);
#else
    return (int)__builtin_popcountll(x);
#endif
}

void init_masks() {
    if (masksInit) return;
#ifdef USE_PEXT_TABLES
    // Helper lambdas
    auto set_bitpos = [](std::array<unsigned char,64*14>& arr, int sq, const std::vector<int>& pos){
        for (int i=0;i<14;i++) arr[sq*14 + i] = (i < (int)pos.size() ? (unsigned char)pos[i] : 255);
    };
    auto set_bitpos_b = [](std::array<unsigned char,64*13>& arr, int sq, const std::vector<int>& pos){
        for (int i=0;i<13;i++) arr[sq*13 + i] = (i < (int)pos.size() ? (unsigned char)pos[i] : 255);
    };
    for (int sq=0; sq<64; ++sq) {
        int r = rank_of(sq), f = file_of(sq);
        // Pawn attacks TO sq (sources that attack sq)
        // White pawn comes from one rank below (r+1)
        if (r < 7) {
            if (f > 0) pawnAttW[sq] |= bb(sq + 8 - 1); // (r+1,f-1)
            if (f < 7) pawnAttW[sq] |= bb(sq + 8 + 1); // (r+1,f+1)
        }
        // Black pawn comes from one rank above (r-1)
        if (r > 0) {
            if (f > 0) pawnAttB[sq] |= bb(sq - 8 - 1);
            if (f < 7) pawnAttB[sq] |= bb(sq - 8 + 1);
        }
        // Knight mask
        const int kd[8][2]={{-2,-1},{-2,1},{-1,-2},{-1,2},{1,-2},{1,2},{2,-1},{2,1}};
        for (auto &d: kd) {
            int rr=r+d[0], ff=f+d[1]; if (rr>=0&&rr<8&&ff>=0&&ff<8) knightMask[sq] |= bb(rr*8+ff);
        }
        // King mask
        for (int dr=-1; dr<=1; ++dr) for (int dc=-1; dc<=1; ++dc) {
            if (!dr && !dc) continue; int rr=r+dr, ff=f+dc; if (rr>=0&&rr<8&&ff>=0&&ff<8) kingMask[sq] |= bb(rr*8+ff);
        }

        // Rook mask (exclude edge squares beyond the board boundary)
        uint64_t rm = 0ULL; std::vector<int> rpos;
        for (int rr=r+1; rr<=6; ++rr) { rm |= bb(rr*8+f); rpos.push_back(rr*8+f); if (rr==6) break; }
        for (int rr=r-1; rr>=1; --rr) { rm |= bb(rr*8+f); rpos.push_back(rr*8+f); if (rr==1) break; }
        for (int ff=f+1; ff<=6; ++ff) { rm |= bb(r*8+ff); rpos.push_back(r*8+ff); if (ff==6) break; }
        for (int ff=f-1; ff>=1; --ff) { rm |= bb(r*8+ff); rpos.push_back(r*8+ff); if (ff==1) break; }
        rookMask[sq] = rm; rookBits[sq] = (int)rpos.size(); set_bitpos(rookBitPos, sq, rpos);

        // Bishop mask
        uint64_t bm = 0ULL; std::vector<int> bpos;
        for (int rr=r+1, ff=f+1; rr<=6 && ff<=6; ++rr, ++ff) { bm |= bb(rr*8+ff); bpos.push_back(rr*8+ff); if (rr==6||ff==6) break; }
        for (int rr=r+1, ff=f-1; rr<=6 && ff>=1; ++rr, --ff) { bm |= bb(rr*8+ff); bpos.push_back(rr*8+ff); if (rr==6||ff==1) break; }
        for (int rr=r-1, ff=f+1; rr>=1 && ff<=6; --rr, ++ff) { bm |= bb(rr*8+ff); bpos.push_back(rr*8+ff); if (rr==1||ff==6) break; }
        for (int rr=r-1, ff=f-1; rr>=1 && ff>=1; --rr, --ff) { bm |= bb(rr*8+ff); bpos.push_back(rr*8+ff); if (rr==1||ff==1) break; }
        bishopMask[sq] = bm; bishopBits[sq] = (int)bpos.size(); set_bitpos_b(bishopBitPos, sq, bpos);
    }
    // Build sliding tables by enumerating all blocker subsets per square
    int rookTotal = 0, bishopTotal = 0;
    for (int sq=0; sq<64; ++sq) { rookOffset[sq] = rookTotal; rookTotal += (1 << rookBits[sq]); }
    for (int sq=0; sq<64; ++sq) { bishopOffset[sq] = bishopTotal; bishopTotal += (1 << bishopBits[sq]); }
    rookTable.assign(rookTotal, 0ULL);
    bishopTable.assign(bishopTotal, 0ULL);

    auto subset_from_index = [](uint64_t mask, const std::array<unsigned char,64*14>& posArr, int sq, int bits, int idx)->uint64_t{
        uint64_t sub=0ULL; for (int i=0;i<bits;i++){ if (idx & (1<<i)) { int p = posArr[sq*14 + i]; if (p!=255) sub |= bb(p); } } return sub & mask; };
    auto subset_from_index_b = [](uint64_t mask, const std::array<unsigned char,64*13>& posArr, int sq, int bits, int idx)->uint64_t{
        uint64_t sub=0ULL; for (int i=0;i<bits;i++){ if (idx & (1<<i)) { int p = posArr[sq*13 + i]; if (p!=255) sub |= bb(p); } } return sub & mask; };

    auto gen_rook_attacks_blockers = [&](int sq, uint64_t blockers)->uint64_t{
        int r=rank_of(sq), f=file_of(sq); uint64_t att=0ULL;
        for (int rr=r+1; rr<8; ++rr) { att |= bb(rr*8+f); if (blockers & bb(rr*8+f)) break; }
        for (int rr=r-1; rr>=0; --rr){ att |= bb(rr*8+f); if (blockers & bb(rr*8+f)) break; }
        for (int ff=f+1; ff<8; ++ff) { att |= bb(r*8+ff); if (blockers & bb(r*8+ff)) break; }
        for (int ff=f-1; ff>=0; --ff){ att |= bb(r*8+ff); if (blockers & bb(r*8+ff)) break; }
        return att;
    };
    auto gen_bishop_attacks_blockers = [&](int sq, uint64_t blockers)->uint64_t{
        int r=rank_of(sq), f=file_of(sq); uint64_t att=0ULL;
        for (int rr=r+1, ff=f+1; rr<8 && ff<8; ++rr,++ff){ att |= bb(rr*8+ff); if (blockers & bb(rr*8+ff)) break; }
        for (int rr=r+1, ff=f-1; rr<8 && ff>=0; ++rr,--ff){ att |= bb(rr*8+ff); if (blockers & bb(rr*8+ff)) break; }
        for (int rr=r-1, ff=f+1; rr>=0 && ff<8; --rr,++ff){ att |= bb(rr*8+ff); if (blockers & bb(rr*8+ff)) break; }
        for (int rr=r-1, ff=f-1; rr>=0 && ff>=0; --rr,--ff){ att |= bb(rr*8+ff); if (blockers & bb(rr*8+ff)) break; }
        return att;
    };
    for (int sq=0; sq<64; ++sq) {
        int bits = rookBits[sq]; int off = rookOffset[sq]; uint64_t mask = rookMask[sq];
        for (int idx=0; idx < (1<<bits); ++idx) {
            uint64_t blockers = subset_from_index(mask, rookBitPos, sq, bits, idx);
            rookTable[off + idx] = gen_rook_attacks_blockers(sq, blockers);
        }
    }
    for (int sq=0; sq<64; ++sq) {
        int bits = bishopBits[sq]; int off = bishopOffset[sq]; uint64_t mask = bishopMask[sq];
        for (int idx=0; idx < (1<<bits); ++idx) {
            uint64_t blockers = subset_from_index_b(mask, bishopBitPos, sq, bits, idx);
            bishopTable[off + idx] = gen_bishop_attacks_blockers(sq, blockers);
        }
    }
    masksInit = true;
#else
    // --- Magic bitboards initialization ---
    // Preselected magic numbers (source: widely used sets; adapted for 64-bit engines)
    static const uint64_t ROOK_MAGICS[64] = {
      0x8a80104000800020ULL,0x140002000100040ULL,0x2801880a0017001ULL,0x100081001000420ULL,
      0x200020010080420ULL,0x3001c0001000100ULL,0x8480008002000100ULL,0x2080088004402900ULL,
      0x800098204000ULL,0x2024401000200040ULL,0x1008020001000200ULL,0x40100800080080ULL,
      0x2000c008010008ULL,0x44000080080080ULL,0x800000800400080ULL,0x8000008002000040ULL,
      0x100008008000ULL,0x4000802000100040ULL,0x8000801000200040ULL,0x8000800800100040ULL,
      0x8000400800200040ULL,0x8000200800100040ULL,0x8000100800200040ULL,0x200008008008ULL,
      0x200040008080ULL,0x100020008080ULL,0x100020004040ULL,0x100010004080ULL,
      0x100008004040ULL,0x100004004080ULL,0x100002004040ULL,0x100001004080ULL,
      0x408000800080ULL,0x2004000800080ULL,0x1004000800080ULL,0x804000800080ULL,
      0x404000800080ULL,0x204000800080ULL,0x104000800080ULL,0x820000800080ULL,
      0x402000800080ULL,0x202000800080ULL,0x102000800080ULL,0x810000800080ULL,
      0x401000800080ULL,0x201000800080ULL,0x101000800080ULL,0x808000800080ULL,
      0x404080008000ULL,0x204080008000ULL,0x104080008000ULL,0x804080008000ULL,
      0x404040008000ULL,0x204040008000ULL,0x104040008000ULL,0x804040008000ULL,
      0x404020008000ULL,0x204020008000ULL,0x104020008000ULL,0x804020008000ULL,
      0x404010008000ULL,0x204010008000ULL,0x104010008000ULL,0x804010008000ULL
    };
    static const uint64_t BISHOP_MAGICS[64] = {
      0x40201008040200ULL,0x80402010080400ULL,0x4020100a080400ULL,0x402214080400ULL,
      0x402214080400ULL,0x4020100a080400ULL,0x80402010080400ULL,0x40201008040200ULL,
      0x201008040200ULL,0x402010080400ULL,0x20100a080400ULL,0x20110c080400ULL,
      0x20110c080400ULL,0x20100a080400ULL,0x402010080400ULL,0x201008040200ULL,
      0x1008040200ULL,0x2010080400ULL,0x10080a0400ULL,0x10090c0400ULL,
      0x10090c0400ULL,0x10080a0400ULL,0x2010080400ULL,0x1008040200ULL,
      0x8040200ULL,0x10080400ULL,0x8080a00ULL,0x8090c00ULL,
      0x8090c00ULL,0x8080a00ULL,0x10080400ULL,0x8040200ULL,
      0x40200ULL,0x80400ULL,0x80a00ULL,0x90c00ULL,
      0x90c00ULL,0x80a00ULL,0x80400ULL,0x40200ULL,
      0x40200ULL,0x80400ULL,0x80a00ULL,0x90c00ULL,
      0x90c00ULL,0x80a00ULL,0x80400ULL,0x40200ULL,
      0x8040200ULL,0x10080400ULL,0x8080a00ULL,0x8090c00ULL,
      0x8090c00ULL,0x8080a00ULL,0x10080400ULL,0x8040200ULL,
      0x1008040200ULL,0x2010080400ULL,0x10080a0400ULL,0x10090c0400ULL,
      0x10090c0400ULL,0x10080a0400ULL,0x2010080400ULL,0x1008040200ULL
    };
    // Shift values (simplified; typical rook 52..64 -> use 52 shift = table size 1<<(64-52)=4096 etc.)
    for (int sq=0; sq<64; ++sq) {
        rookMagicShift[sq] = 52; // conservative
        bishopMagicShift[sq] = 55; // bishop fewer squares
        rookMagic[sq] = ROOK_MAGICS[sq];
        bishopMagic[sq] = BISHOP_MAGICS[sq];
    }
    // Occupancy masks excluding board edges
    auto build_mask = [](int sq, bool rook)->uint64_t {
        int r=rank_of(sq), f=file_of(sq); uint64_t m=0ULL;
        static const int dirs[4][2]={{1,0},{-1,0},{0,1},{0,-1}};
        static const int ddiag[4][2]={{1,1},{1,-1},{-1,1},{-1,-1}};
        if (rook) {
            for (auto &d: dirs){ int rr=r+d[0], ff=f+d[1]; while(rr>0&&rr<7&&ff>0&&ff<7){ m |= bb(rr*8+ff); rr+=d[0]; ff+=d[1]; } }
        } else {
            for (auto &d: ddiag){ int rr=r+d[0], ff=f+d[1]; while(rr>0&&rr<7&&ff>0&&ff<7){ m |= bb(rr*8+ff); rr+=d[0]; ff+=d[1]; } }
        }
        return m;
    };
    for (int sq=0; sq<64; ++sq){ rookMagicMask[sq]=build_mask(sq,true); bishopMagicMask[sq]=build_mask(sq,false); }
    // Compute table sizes & offsets
    int rookTotal=0, bishopTotal=0;
    for (int sq=0; sq<64; ++sq){ rookMagicOffset[sq]=rookTotal; rookTotal += (1 << (64 - rookMagicShift[sq])); }
    for (int sq=0; sq<64; ++sq){ bishopMagicOffset[sq]=bishopTotal; bishopTotal += (1 << (64 - bishopMagicShift[sq])); }
    rookMagicTable.assign(rookTotal,0ULL);
    bishopMagicTable.assign(bishopTotal,0ULL);
    auto gen_attacks = [](int sq, uint64_t blockers, bool rookLike){
        int r=rank_of(sq), f=file_of(sq); uint64_t att=0ULL;
        static const int rdirs[4][2]={{1,0},{-1,0},{0,1},{0,-1}};
        static const int bdirs[4][2]={{1,1},{1,-1},{-1,1},{-1,-1}};
        auto &dirs = rookLike? rdirs : bdirs;
        for (int i=0;i<4;i++){ int dr=dirs[i][0], dc=dirs[i][1]; int rr=r+dr, ff=f+dc; while(rr>=0&&rr<8&&ff>=0&&ff<8){ int s=rr*8+ff; att |= bb(s); if (blockers & bb(s)) break; rr+=dr; ff+=dc; } }
        return att;
    };
    // Enumerate subsets by iterating sub = (sub-1) & mask technique
    for (int sq=0; sq<64; ++sq){
        uint64_t mask = rookMagicMask[sq]; uint64_t sub=mask;
        do {
            uint64_t index = ((sub * rookMagic[sq]) >> rookMagicShift[sq]);
            rookMagicTable[rookMagicOffset[sq] + index] = gen_attacks(sq, sub, true);
            sub = (sub - 1) & mask;
        } while (sub != mask);
    }
    for (int sq=0; sq<64; ++sq){
        uint64_t mask = bishopMagicMask[sq]; uint64_t sub=mask;
        do {
            uint64_t index = ((sub * bishopMagic[sq]) >> bishopMagicShift[sq]);
            bishopMagicTable[bishopMagicOffset[sq] + index] = gen_attacks(sq, sub, false);
            sub = (sub - 1) & mask;
        } while (sub != mask);
    }
    masksInit = true;
#endif
}
// Compress occ subset (occ & mask) into small index using precomputed bit positions.
#ifdef USE_PEXT_TABLES
static inline int compress_index(uint64_t occ, uint64_t mask, const std::array<unsigned char,64*14>& posArr, int sq, int bits){
    int idx=0; for (int i=0;i<bits;i++){ int p = posArr[sq*14 + i]; if (p==255) break; if (occ & bb(p)) idx |= (1<<i); } return idx;
}
static inline int compress_index_b(uint64_t occ, uint64_t mask, const std::array<unsigned char,64*13>& posArr, int sq, int bits){
    int idx=0; for (int i=0;i<bits;i++){ int p = posArr[sq*13 + i]; if (p==255) break; if (occ & bb(p)) idx |= (1<<i); } return idx;
}

static inline uint64_t rook_attacks(uint64_t occ, int sq){
    int idx = compress_index(occ & rookMask[sq], rookMask[sq], rookBitPos, sq, rookBits[sq]);
    return rookTable[rookOffset[sq] + idx];
}
static inline uint64_t bishop_attacks(uint64_t occ, int sq){
    int idx = compress_index_b(occ & bishopMask[sq], bishopMask[sq], bishopBitPos, sq, bishopBits[sq]);
    return bishopTable[bishopOffset[sq] + idx];
}
#else
static inline uint64_t rook_attacks(uint64_t occ, int sq){
    uint64_t blockers = occ & rookMagicMask[sq];
    uint64_t index = (blockers * rookMagic[sq]) >> rookMagicShift[sq];
    return rookMagicTable[rookMagicOffset[sq] + index];
}
static inline uint64_t bishop_attacks(uint64_t occ, int sq){
    uint64_t blockers = occ & bishopMagicMask[sq];
    uint64_t index = (blockers * bishopMagic[sq]) >> bishopMagicShift[sq];
    return bishopMagicTable[bishopMagicOffset[sq] + index];
}
#endif

bool parse_fen(const std::string& fen, Position& out) {
    init_masks();
    std::istringstream ss(fen);
    std::string boardPart, stm, castling, ep, half, full;
    if (!(ss >> boardPart >> stm >> castling >> ep >> half >> full)) return false;
    out = Position{};
    int r=7, f=0;
    for (char c: boardPart) {
        if (c=='/') { r--; f=0; continue; }
        if (c>='1'&&c<='8') { f += c - '0'; continue; }
        int sq = r*8 + f;
        uint64_t mask = bb(sq);
        switch(c) {
            case 'P': out.bb.WP |= mask; break; case 'N': out.bb.WN |= mask; break; case 'B': out.bb.WB |= mask; break; case 'R': out.bb.WR |= mask; break; case 'Q': out.bb.WQ |= mask; break; case 'K': out.bb.WK |= mask; break;
            case 'p': out.bb.BP |= mask; break; case 'n': out.bb.BN |= mask; break; case 'b': out.bb.BB |= mask; break; case 'r': out.bb.BR |= mask; break; case 'q': out.bb.BQ |= mask; break; case 'k': out.bb.BK |= mask; break;
            default: return false;
        }
        f++;
    }
    out.sideToMove = (stm == "b" ? 1 : 0);
    out.castleRights = 0;
    if (castling != "-") {
        for (char c: castling) {
            switch(c) {
                case 'K': out.castleRights |= 1; break; case 'Q': out.castleRights |= 2; break; case 'k': out.castleRights |= 4; break; case 'q': out.castleRights |= 8; break;
                default: break; // ignore extended X-FEN letters for now
            }
        }
    }
    out.epSquare = -1;
    if (ep != "-") {
        if (ep.size()==2) {
            int file = ep[0]-'a'; int rank = ep[1]-'1';
            if (file>=0&&file<8&&rank>=0&&rank<8) out.epSquare = rank*8 + file;
        }
    }
    out.bb.occWhite = out.bb.WP|out.bb.WN|out.bb.WB|out.bb.WR|out.bb.WQ|out.bb.WK;
    out.bb.occBlack = out.bb.BP|out.bb.BN|out.bb.BB|out.bb.BR|out.bb.BQ|out.bb.BK;
    out.bb.occAll = out.bb.occWhite | out.bb.occBlack;
    return true;
}

std::string to_fen(const Position& pos) {
    // Simplified: only board + side + castling + ep + clocks
    std::string s;
    for (int r=7; r>=0; --r) {
        int empty=0; for (int f=0; f<8; ++f) {
            int sq=r*8+f; uint64_t m=bb(sq); char pc='.';
            if (pos.bb.WP & m) pc='P'; else if (pos.bb.WN & m) pc='N'; else if (pos.bb.WB & m) pc='B'; else if (pos.bb.WR & m) pc='R'; else if (pos.bb.WQ & m) pc='Q'; else if (pos.bb.WK & m) pc='K';
            else if (pos.bb.BP & m) pc='p'; else if (pos.bb.BN & m) pc='n'; else if (pos.bb.BB & m) pc='b'; else if (pos.bb.BR & m) pc='r'; else if (pos.bb.BQ & m) pc='q'; else if (pos.bb.BK & m) pc='k';
            if (pc=='.') { empty++; continue; }
            if (empty) { s += char('0'+empty); empty=0; }
            s += pc;
        }
        if (empty) s += char('0'+empty);
        if (r>0) s += '/';
    }
    s += ' ';
    s += (pos.sideToMove? 'b':'w');
    s += ' ';
    if (pos.castleRights==0) s += '-'; else {
        if (pos.castleRights & 1) s += 'K';
        if (pos.castleRights & 2) s += 'Q';
        if (pos.castleRights & 4) s += 'k';
        if (pos.castleRights & 8) s += 'q';
    }
    s += ' ';
    if (pos.epSquare==-1) s += '-'; else {
        int r = rank_of(pos.epSquare); int f = file_of(pos.epSquare);
        char fileChar = char('a'+f); char rankChar = char('1'+r); s += fileChar; s += rankChar;
    }
    s += " 0 1"; // clocks placeholder
    return s;
}

// Attack detection (bitboards + simple rays)
bool square_attacked(const Position& pos, int sq, int byWhite) {
    uint64_t occ = pos.bb.occAll;
    if (byWhite) {
        if (pawnAttW[sq] & pos.bb.WP) return true;
        if (knightMask[sq] & pos.bb.WN) return true;
        if (kingMask[sq] & pos.bb.WK) return true;
        if ((rook_attacks(occ, sq) & (pos.bb.WR | pos.bb.WQ)) != 0ULL) return true;
        if ((bishop_attacks(occ, sq) & (pos.bb.WB | pos.bb.WQ)) != 0ULL) return true;
    } else {
        if (pawnAttB[sq] & pos.bb.BP) return true;
        if (knightMask[sq] & pos.bb.BN) return true;
        if (kingMask[sq] & pos.bb.BK) return true;
        if ((rook_attacks(occ, sq) & (pos.bb.BR | pos.bb.BQ)) != 0ULL) return true;
        if ((bishop_attacks(occ, sq) & (pos.bb.BB | pos.bb.BQ)) != 0ULL) return true;
    }
    return false;
}

// Return bitboard of pieces (of side byWhite) attacking target square.
std::uint64_t attackers_to(const Position& pos, int sq, int byWhite) {
    uint64_t atk = 0ULL; uint64_t occ = pos.bb.occAll;
    if (byWhite) {
        if (pawnAttW[sq] & pos.bb.WP) atk |= pawnAttW[sq] & pos.bb.WP;
        if (knightMask[sq] & pos.bb.WN) atk |= knightMask[sq] & pos.bb.WN;
        if (kingMask[sq] & pos.bb.WK) atk |= kingMask[sq] & pos.bb.WK;
    } else {
        if (pawnAttB[sq] & pos.bb.BP) atk |= pawnAttB[sq] & pos.bb.BP;
        if (knightMask[sq] & pos.bb.BN) atk |= knightMask[sq] & pos.bb.BN;
        if (kingMask[sq] & pos.bb.BK) atk |= kingMask[sq] & pos.bb.BK;
    }
    // Sliding via precomputed tables
    uint64_t rookAtk = rook_attacks(occ, sq);
    uint64_t bishAtk = bishop_attacks(occ, sq);
    if (byWhite) {
        atk |= rookAtk & (pos.bb.WR | pos.bb.WQ);
        atk |= bishAtk & (pos.bb.WB | pos.bb.WQ);
    } else {
        atk |= rookAtk & (pos.bb.BR | pos.bb.BQ);
        atk |= bishAtk & (pos.bb.BB | pos.bb.BQ);
    }
    return atk;
}

int evaluate_material(const Position& pos) {
    // AVX2 popcnt accelerate material sum via intrinsic if available
#if defined(__AVX2__) || defined(_MSC_VER)
    auto count = [](uint64_t bb) { return (int)_mm_popcnt_u64(bb); };
#else
    auto count = [](uint64_t bb) { return (int)__builtin_popcountll(bb); };
#endif
    int material = 0;
    material += count(pos.bb.WP) * pieceValue[0];
    material += count(pos.bb.WN) * pieceValue[1];
    material += count(pos.bb.WB) * pieceValue[2];
    material += count(pos.bb.WR) * pieceValue[3];
    material += count(pos.bb.WQ) * pieceValue[4];
    material -= count(pos.bb.BP) * pieceValue[0];
    material -= count(pos.bb.BN) * pieceValue[1];
    material -= count(pos.bb.BB) * pieceValue[2];
    material -= count(pos.bb.BR) * pieceValue[3];
    material -= count(pos.bb.BQ) * pieceValue[4];
    return material;
}

int evaluate(const Position& pos) {
    return evaluate_material(pos) + nnue_eval(pos);
}

void generate_pseudo_moves(const Position& pos, std::vector<Move>& out) {
    out.clear();
    uint64_t ownOcc = pos.sideToMove ? pos.bb.occBlack : pos.bb.occWhite;
    uint64_t oppOcc = pos.sideToMove ? pos.bb.occWhite : pos.bb.occBlack;
    uint64_t empty = ~pos.bb.occAll;

    // --- Pawns ---
    if (!pos.sideToMove) {
        // White
        uint64_t pawns = pos.bb.WP;
        // Single pushes
        uint64_t single = (pawns << 8) & empty;
        // Promotions (to rank 7 internal => bits 56..63)
        uint64_t promoSingles = single & 0xff00000000000000ULL;
        uint64_t quietSingles = single & ~0xff00000000000000ULL;
        while (quietSingles) {
            int to = lsb_index(quietSingles); quietSingles &= quietSingles - 1;
            Move m; m.to = to; m.from = to - 8; out.push_back(m);
        }
        while (promoSingles) {
            int to = lsb_index(promoSingles); promoSingles &= promoSingles - 1;
            int from = to - 8;
            for (int promoPiece : {1,2,3,4}) { // N,B,R,Q encoded arbitrarily
                Move m; m.from=from; m.to=to; m.promo=promoPiece; out.push_back(m);
            }
        }
        // Double pushes from rank 1 (bits 8..15)
        uint64_t rank1Mask = 0x000000000000FF00ULL;
        uint64_t canSingle = (pawns & rank1Mask) << 8 & empty;
        uint64_t dbl = (canSingle << 8) & empty;
        while (dbl) { int to = lsb_index(dbl); dbl &= dbl - 1; Move m; m.to=to; m.from=to-16; m.isDoublePawnPush=true; out.push_back(m); }
        // Captures
        uint64_t westCap = (pawns << 7) & oppOcc & ~0x0101010101010101ULL; // not from file A
        uint64_t eastCap = (pawns << 9) & oppOcc & ~0x8080808080808080ULL; // not from file H
        uint64_t promoWest = westCap & 0xff00000000000000ULL;
        uint64_t promoEast = eastCap & 0xff00000000000000ULL;
        westCap &= ~0xff00000000000000ULL;
        eastCap &= ~0xff00000000000000ULL;
        while (westCap) { int to=lsb_index(westCap); westCap &= westCap-1; Move m; m.to=to; m.from=to-7; m.isCapture=true; out.push_back(m); }
        while (eastCap) { int to=lsb_index(eastCap); eastCap &= eastCap-1; Move m; m.to=to; m.from=to-9; m.isCapture=true; out.push_back(m); }
        while (promoWest) { int to=lsb_index(promoWest); promoWest &= promoWest-1; int from=to-7; for(int promoPiece:{1,2,3,4}){ Move m; m.from=from; m.to=to; m.promo=promoPiece; m.isCapture=true; out.push_back(m);} }
        while (promoEast) { int to=lsb_index(promoEast); promoEast &= promoEast-1; int from=to-9; for(int promoPiece:{1,2,3,4}){ Move m; m.from=from; m.to=to; m.promo=promoPiece; m.isCapture=true; out.push_back(m);} }
        // En passant
        if (pos.epSquare != -1) {
            int ep = pos.epSquare;
            // White pawn could capture ep square from ep-9 (east) or ep-7 (west)
            int westFrom = ep - 7; int eastFrom = ep - 9;
            if (westFrom >=0 && westFrom <64 && (pawns & bb(westFrom)) && (westFrom%8)!=7) { Move m; m.from=westFrom; m.to=ep; m.isEnPassant=true; m.isCapture=true; out.push_back(m);}            
            if (eastFrom >=0 && eastFrom <64 && (pawns & bb(eastFrom)) && (eastFrom%8)!=0) { Move m; m.from=eastFrom; m.to=ep; m.isEnPassant=true; m.isCapture=true; out.push_back(m);}            
        }
    } else {
        // Black pawns
        uint64_t pawns = pos.bb.BP;
        uint64_t single = (pawns >> 8) & empty;
        uint64_t promoSingles = single & 0x00000000000000FFULL;
        uint64_t quietSingles = single & ~0x00000000000000FFULL;
        while (quietSingles) { int to=lsb_index(quietSingles); quietSingles &= quietSingles-1; Move m; m.to=to; m.from=to+8; out.push_back(m); }
        while (promoSingles) { int to=lsb_index(promoSingles); promoSingles &= promoSingles-1; int from=to+8; for(int promoPiece:{1,2,3,4}){ Move m; m.from=from; m.to=to; m.promo=promoPiece; out.push_back(m);} }
        uint64_t rank6Mask = 0x00FF000000000000ULL;
        uint64_t canSingle = (pawns & rank6Mask) >> 8 & empty;
        uint64_t dbl = (canSingle >> 8) & empty;
        while (dbl) { int to=lsb_index(dbl); dbl &= dbl-1; Move m; m.to=to; m.from=to+16; m.isDoublePawnPush=true; out.push_back(m); }
        uint64_t westCap = (pawns >> 9) & oppOcc & ~0x0101010101010101ULL; // from not file A
        uint64_t eastCap = (pawns >> 7) & oppOcc & ~0x8080808080808080ULL; // from not file H
        uint64_t promoWest = westCap & 0x00000000000000FFULL;
        uint64_t promoEast = eastCap & 0x00000000000000FFULL;
        westCap &= ~0x00000000000000FFULL; eastCap &= ~0x00000000000000FFULL;
        while (westCap) { int to=lsb_index(westCap); westCap &= westCap-1; Move m; m.to=to; m.from=to+9; m.isCapture=true; out.push_back(m);}        
        while (eastCap) { int to=lsb_index(eastCap); eastCap &= eastCap-1; Move m; m.to=to; m.from=to+7; m.isCapture=true; out.push_back(m);}        
        while (promoWest) { int to=lsb_index(promoWest); promoWest &= promoWest-1; int from=to+9; for(int promoPiece:{1,2,3,4}){ Move m; m.from=from; m.to=to; m.promo=promoPiece; m.isCapture=true; out.push_back(m);} }
        while (promoEast) { int to=lsb_index(promoEast); promoEast &= promoEast-1; int from=to+7; for(int promoPiece:{1,2,3,4}){ Move m; m.from=from; m.to=to; m.promo=promoPiece; m.isCapture=true; out.push_back(m);} }
        if (pos.epSquare != -1) {
            int ep = pos.epSquare;
            int westFrom = ep + 9; int eastFrom = ep + 7;
            if (westFrom >=0 && westFrom <64 && (pawns & bb(westFrom)) && (westFrom%8)!=7) { Move m; m.from=westFrom; m.to=ep; m.isEnPassant=true; m.isCapture=true; out.push_back(m);}            
            if (eastFrom >=0 && eastFrom <64 && (pawns & bb(eastFrom)) && (eastFrom%8)!=0) { Move m; m.from=eastFrom; m.to=ep; m.isEnPassant=true; m.isCapture=true; out.push_back(m);}            
        }
    }

    // Helper lambda to iterate pieces
    auto gen_leapers = [&](uint64_t pieces, const std::array<uint64_t,64>& maskArr){
        while (pieces) {
            int from = lsb_index(pieces); pieces &= pieces - 1; uint64_t attacks = maskArr[from] & ~ownOcc;
            while (attacks) { int to = lsb_index(attacks); attacks &= attacks - 1; Move m; m.from=from; m.to=to; m.isCapture = (oppOcc & bb(to)); out.push_back(m); }
        }
    };
    if (!pos.sideToMove) {
        gen_leapers(pos.bb.WN, knightMask);
        gen_leapers(pos.bb.WK, kingMask); // king non-castle moves
    } else {
        gen_leapers(pos.bb.BN, knightMask);
        gen_leapers(pos.bb.BK, kingMask);
    }
    // Sliding pieces: use precomputed tables (fast, loopless per ray)
    auto gen_rook_like = [&](uint64_t pieces){
        while (pieces) {
            int from = lsb_index(pieces); pieces &= pieces - 1;
            uint64_t attacks = rook_attacks(pos.bb.occAll, from) & ~ownOcc;
            while (attacks) { int to = lsb_index(attacks); attacks &= attacks - 1; Move m; m.from=from; m.to=to; m.isCapture = (oppOcc & bb(to)); out.push_back(m); }
        }
    };
    auto gen_bishop_like = [&](uint64_t pieces){
        while (pieces) {
            int from = lsb_index(pieces); pieces &= pieces - 1;
            uint64_t attacks = bishop_attacks(pos.bb.occAll, from) & ~ownOcc;
            while (attacks) { int to = lsb_index(attacks); attacks &= attacks - 1; Move m; m.from=from; m.to=to; m.isCapture = (oppOcc & bb(to)); out.push_back(m); }
        }
    };
    if (!pos.sideToMove) {
        gen_bishop_like(pos.bb.WB);
        gen_rook_like(pos.bb.WR);
        gen_bishop_like(pos.bb.WQ); gen_rook_like(pos.bb.WQ);
    } else {
        gen_bishop_like(pos.bb.BB);
        gen_rook_like(pos.bb.BR);
        gen_bishop_like(pos.bb.BQ); gen_rook_like(pos.bb.BQ);
    }
    // Castling (basic validation: king/rook unmoved encoded in castleRights; path empty; squares not attacked)
    uint64_t king = pos.sideToMove? pos.bb.BK : pos.bb.WK;
    if (king) {
        int ksq = lsb_index(king);
        bool white = (pos.sideToMove==0);
        if (white) {
            // O-O: king e1 (4) to g1 (6), rook h1 (7) to f1 (5)
            // Squares (e1,f1,g1) must not be attacked by BLACK
            if ((pos.castleRights & 1) && !(pos.bb.occAll & (bb(5)|bb(6))) && !square_attacked(pos,4,0) && !square_attacked(pos,5,0) && !square_attacked(pos,6,0)) {
                Move m; m.from=ksq; m.to=6; m.isCastle=true; out.push_back(m);
            }
            // O-O-O: e1 to c1 (2); squares d1(3) c1(2) b1(1) must be clear except rook a1(0)
            // Squares (e1,d1,c1) must not be attacked by BLACK
            if ((pos.castleRights & 2) && !(pos.bb.occAll & (bb(3)|bb(2)|bb(1))) && !square_attacked(pos,4,0) && !square_attacked(pos,3,0) && !square_attacked(pos,2,0)) {
                Move m; m.from=ksq; m.to=2; m.isCastle=true; out.push_back(m);
            }
        } else {
            // Black O-O: e8 (60) to g8 (62)
            // Squares (e8,f8,g8) must not be attacked by WHITE
            if ((pos.castleRights & 4) && !(pos.bb.occAll & (bb(61)|bb(62))) && !square_attacked(pos,60,1) && !square_attacked(pos,61,1) && !square_attacked(pos,62,1)) {
                Move m; m.from=ksq; m.to=62; m.isCastle=true; out.push_back(m);
            }
            // Black O-O-O: e8 to c8 (58)
            // Squares (e8,d8,c8) must not be attacked by WHITE
            if ((pos.castleRights & 8) && !(pos.bb.occAll & (bb(59)|bb(58)|bb(57))) && !square_attacked(pos,60,1) && !square_attacked(pos,59,1) && !square_attacked(pos,58,1)) {
                Move m; m.from=ksq; m.to=58; m.isCastle=true; out.push_back(m);
            }
        }
    }
}

void apply_move(Position& pos, const Move& m, Position& out) {
    out = pos; // shallow copy
    uint64_t fromMask = bb(m.from); uint64_t toMask = bb(m.to);
    // Identify moved piece by checking bitboards (order matters)
    auto remove_capture = [&](bool white){
        if (!m.isCapture) return;
        if (white) { // white capturing black piece
            out.bb.BP &= ~toMask; out.bb.BN &= ~toMask; out.bb.BB &= ~toMask; out.bb.BR &= ~toMask; out.bb.BQ &= ~toMask; out.bb.BK &= ~toMask;
        } else {
            out.bb.WP &= ~toMask; out.bb.WN &= ~toMask; out.bb.WB &= ~toMask; out.bb.WR &= ~toMask; out.bb.WQ &= ~toMask; out.bb.WK &= ~toMask;
        }
    };
    bool white = (pos.sideToMove==0);
    // En passant capture
    if (m.isEnPassant) {
        if (white) {
            int capSq = m.to - 8; out.bb.BP &= ~bb(capSq);
        } else {
            int capSq = m.to + 8; out.bb.WP &= ~bb(capSq);
        }
    }
    // Pawn moves
    if (white && (pos.bb.WP & fromMask)) {
        out.bb.WP &= ~fromMask; // remove from
        if (m.promo) {
            // Map promo codes 1=N 2=B 3=R 4=Q
            switch(m.promo){ case 1: out.bb.WN |= toMask; break; case 2: out.bb.WB |= toMask; break; case 3: out.bb.WR |= toMask; break; case 4: out.bb.WQ |= toMask; break; }
        } else {
            out.bb.WP |= toMask;
        }
        remove_capture(true);
    } else if (!white && (pos.bb.BP & fromMask)) {
        out.bb.BP &= ~fromMask;
        if (m.promo) { switch(m.promo){ case 1: out.bb.BN |= toMask; break; case 2: out.bb.BB |= toMask; break; case 3: out.bb.BR |= toMask; break; case 4: out.bb.BQ |= toMask; break; } }
        else { out.bb.BP |= toMask; }
        remove_capture(false);
    } else if (white && (pos.bb.WN & fromMask)) {
        out.bb.WN ^= fromMask; out.bb.WN |= toMask; remove_capture(true);
    } else if (!white && (pos.bb.BN & fromMask)) {
        out.bb.BN ^= fromMask; out.bb.BN |= toMask; remove_capture(false);
    } else if (white && (pos.bb.WB & fromMask)) {
        out.bb.WB ^= fromMask; out.bb.WB |= toMask; remove_capture(true);
    } else if (!white && (pos.bb.BB & fromMask)) {
        out.bb.BB ^= fromMask; out.bb.BB |= toMask; remove_capture(false);
    } else if (white && (pos.bb.WR & fromMask)) {
        out.bb.WR ^= fromMask; out.bb.WR |= toMask; remove_capture(true);
    } else if (!white && (pos.bb.BR & fromMask)) {
        out.bb.BR ^= fromMask; out.bb.BR |= toMask; remove_capture(false);
    } else if (white && (pos.bb.WQ & fromMask)) {
        out.bb.WQ ^= fromMask; out.bb.WQ |= toMask; remove_capture(true);
    } else if (!white && (pos.bb.BQ & fromMask)) {
        out.bb.BQ ^= fromMask; out.bb.BQ |= toMask; remove_capture(false);
    } else if (white && (pos.bb.WK & fromMask)) {
        out.bb.WK ^= fromMask; out.bb.WK |= toMask; remove_capture(true);
    } else if (!white && (pos.bb.BK & fromMask)) {
        out.bb.BK ^= fromMask; out.bb.BK |= toMask; remove_capture(false);
    }
    // Castling rook move
    if (m.isCastle) {
        if (white) {
            if (m.to == 6) { // O-O
                out.bb.WR &= ~bb(7); out.bb.WR |= bb(5);
            } else if (m.to == 2) {
                out.bb.WR &= ~bb(0); out.bb.WR |= bb(3);
            }
            out.castleRights &= ~(1|2);
        } else {
            if (m.to == 62) { out.bb.BR &= ~bb(63); out.bb.BR |= bb(61); }
            else if (m.to == 58) { out.bb.BR &= ~bb(56); out.bb.BR |= bb(59); }
            out.castleRights &= ~(4|8);
        }
    }
    // Remove castling rights if king or rook moved from original squares
    if (white) {
        if (fromMask & pos.bb.WK) out.castleRights &= ~(1|2);
        if (fromMask & pos.bb.WR) {
            if (m.from == 7) out.castleRights &= ~1; else if (m.from == 0) out.castleRights &= ~2;
        }
    } else {
        if (fromMask & pos.bb.BK) out.castleRights &= ~(4|8);
        if (fromMask & pos.bb.BR) {
            if (m.from == 63) out.castleRights &= ~4; else if (m.from == 56) out.castleRights &= ~8;
        }
    }
    // Also remove rights if rook captured
    if (m.isCapture && !m.isEnPassant) {
        if (white) {
            if (m.to == 63) out.castleRights &= ~4; else if (m.to == 56) out.castleRights &= ~8;
        } else {
            if (m.to == 7) out.castleRights &= ~1; else if (m.to == 0) out.castleRights &= ~2;
        }
    }
    // Set en-passant square
    if (m.isDoublePawnPush) {
        out.epSquare = white ? (m.from + 8) : (m.from - 8);
    } else {
        out.epSquare = -1;
    }
    // Update occ
    out.bb.occWhite = out.bb.WP|out.bb.WN|out.bb.WB|out.bb.WR|out.bb.WQ|out.bb.WK;
    out.bb.occBlack = out.bb.BP|out.bb.BN|out.bb.BB|out.bb.BR|out.bb.BQ|out.bb.BK;
    out.bb.occAll = out.bb.occWhite | out.bb.occBlack;
    out.sideToMove ^= 1;
}

void filter_legal(const Position& pos, const std::vector<Move>& pseudo, std::vector<Move>& legal) {
    legal.clear();
    bool white = (pos.sideToMove==0);
    uint64_t kingBB = white? pos.bb.WK : pos.bb.BK; if (!kingBB) return; int kingSq = lsb_index(kingBB);
    // Determine current checkers
    uint64_t checkers = attackers_to(pos, kingSq, white?1:0);
    int checkerCount = popcount64(checkers);
    // Precompute blocking mask if single checker and sliding
    uint64_t blockMask = 0ULL; int checkerSq = -1;
    if (checkerCount == 1) {
        checkerSq = lsb_index(checkers);
        // If checker is sliding piece create line squares between king and checker
        uint64_t sliding = (white? (pos.bb.BB|pos.bb.BR|pos.bb.BQ) : (pos.bb.WB|pos.bb.WR|pos.bb.WQ));
        if (sliding & bb(checkerSq)) {
            int rK=rank_of(kingSq), fK=file_of(kingSq); int rC=rank_of(checkerSq), fC=file_of(checkerSq);
            int dr = (rC==rK)?0: (rC>rK?1:-1);
            int dc = (fC==fK)?0: (fC>fK?1:-1);
            if (dr==0 || dc==0 || std::abs(rC-rK)==std::abs(fC-fK)) {
                int r=rK+dr, f=fK+dc; while (r!=rC || f!=fC) { blockMask |= bb(r*8+f); r+=dr; f+=dc; }
            }
        }
        // include capturing square itself
        blockMask |= bb(checkerSq);
    }
    // If double check: only king moves considered
    bool onlyKingMoves = (checkerCount >= 2);
    for (const auto& m : pseudo) {
        if (onlyKingMoves && !( (white? pos.bb.WK: pos.bb.BK) & bb(m.from))) continue;
        if (checkerCount == 1 && !((white? pos.bb.WK: pos.bb.BK) & bb(m.from))) {
            // Non-king move must capture checker or block
            if (!(blockMask & bb(m.to))) continue;
        }
        Position child; apply_move(const_cast<Position&>(pos), m, child); // apply_move takes non-const ref
        uint64_t childKingBB = child.sideToMove? child.bb.WK : child.bb.BK;
        if (!childKingBB) continue; int childKingSq = lsb_index(childKingBB);
        if (square_attacked(child, childKingSq, child.sideToMove?0:1)) continue;
        legal.push_back(m);
    }
}

int negamax(Position& pos, int depth, int alpha, int beta, std::vector<Move>& pv) {
    if (depth==0) return evaluate(pos);
    std::vector<Move> pseudo; generate_pseudo_moves(pos, pseudo);
    std::vector<Move> legal; filter_legal(pos, pseudo, legal);
    if (legal.empty()) return evaluate(pos); // treat as terminal (placeholder: no mate eval)
    int bestScore = -1000000; pv.clear();
    std::vector<Move> childPV;
    for (const auto& m : legal) {
        Position child; apply_move(pos, m, child);
        int score = -negamax(child, depth-1, -beta, -alpha, childPV);
        if (score > bestScore) {
            bestScore = score; pv = childPV; pv.insert(pv.begin(), m);
        }
        alpha = std::max(alpha, score);
        if (alpha >= beta) break;
    }
    return bestScore;
}

std::string choose_move(const std::string& fen, int depth) {
    Position pos; if (!parse_fen(fen, pos)) return "";
    std::vector<Move> pv; int score = negamax(pos, depth, -1000000, 1000000, pv);
    if (pv.empty()) return "";
    auto encodeSq = [](int sq){ char f = char('a' + file_of(sq)); char r = char('1' + rank_of(sq)); return std::string({f,r}); };
    std::string uci = encodeSq(pv.front().from) + encodeSq(pv.front().to);
    return uci;
}

std::vector<std::string> legal_moves_uci(const std::string& fen) {
    Position pos; if (!parse_fen(fen, pos)) return {};
    std::vector<Move> pseudo; generate_pseudo_moves(pos, pseudo);
    std::vector<Move> legal; filter_legal(pos, pseudo, legal);
    auto encodeSq = [](int sq){ char f = char('a' + file_of(sq)); char r = char('1' + rank_of(sq)); return std::string({f,r}); };
    std::vector<std::string> out; out.reserve(legal.size());
    for (const auto& m : legal) {
        std::string uci = encodeSq(m.from) + encodeSq(m.to);
        if (m.promo) {
            // Map promo codes 1=N 2=B 3=R 4=Q to SAN chars nbrq
            char pr = 'q';
            switch(m.promo){ case 1: pr='n'; break; case 2: pr='b'; break; case 3: pr='r'; break; case 4: pr='q'; break; default: pr='q'; }
            uci.push_back(pr);
        }
        out.push_back(std::move(uci));
    }
    return out;
}

std::uint64_t perft(Position& pos, int depth) {
    if (depth == 0) return 1ULL;
    std::vector<Move> pseudo; generate_pseudo_moves(pos, pseudo);
    std::vector<Move> legal; filter_legal(pos, pseudo, legal);
    if (depth == 1) return (std::uint64_t)legal.size();
    std::uint64_t nodes = 0ULL;
    for (const auto& m : legal) {
        Position child; apply_move(pos, m, child);
        nodes += perft(child, depth - 1);
    }
    return nodes;
}

} // namespace engine

static thread_local char g_outBuf[32];
static thread_local std::string g_movesBuf;
static int g_avx2_enabled = 1;

extern "C" const char* engine_choose(const char* fen, int depth) {
    if (!fen) return "";
    std::string move = engine::choose_move(fen, depth>0? depth:1);
    std::snprintf(g_outBuf, sizeof(g_outBuf), "%s", move.c_str());
    return g_outBuf;
}

extern "C" void engine_set_avx2(int enabled) {
    g_avx2_enabled = enabled ? 1 : 0; // stub; could gate AVX2 paths
}

extern "C" unsigned long long engine_perft(const char* fen, int depth) {
    if (!fen) return 0ULL;
    engine::Position pos; if (!engine::parse_fen(fen, pos)) return 0ULL;
    return engine::perft(pos, depth);
}

extern "C" const char* engine_legal_moves(const char* fen) {
    if (!fen) return "";
    std::vector<std::string> moves = engine::legal_moves_uci(fen);
    g_movesBuf.clear();
    for (size_t i=0;i<moves.size();++i){
        if (i) g_movesBuf.push_back(' ');
        g_movesBuf += moves[i];
    }
    return g_movesBuf.c_str();
}
