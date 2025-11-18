#include <node_api.h>
#include <assert.h>
#include <string>
#include "../../native/engine.hpp"

static napi_value ThrowType(napi_env env, const char* msg){
  napi_value err; napi_create_string_utf8(env, msg, NAPI_AUTO_LENGTH, &err);
  napi_throw_type_error(env, nullptr, msg); return nullptr;
}

static napi_value Choose(napi_env env, napi_callback_info info){
  size_t argc=2; napi_value args[2]; napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  if (argc < 1) return ThrowType(env, "choose expects (fen[, depth])");
  // fen
  size_t len; napi_get_value_string_utf8(env, args[0], nullptr, 0, &len);
  std::string fen; fen.resize(len);
  napi_get_value_string_utf8(env, args[0], fen.data(), len+1, &len);
  // depth
  int32_t depth = 3; if (argc >= 2) napi_get_value_int32(env, args[1], &depth);
  std::string mv = engine::choose_move(fen, depth);
  napi_value out; napi_create_string_utf8(env, mv.c_str(), NAPI_AUTO_LENGTH, &out);
  return out;
}

static napi_value Perft(napi_env env, napi_callback_info info){
  size_t argc=2; napi_value args[2]; napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  if (argc < 2) return ThrowType(env, "perft expects (fen, depth)");
  // fen
  size_t len; napi_get_value_string_utf8(env, args[0], nullptr, 0, &len);
  std::string fen; fen.resize(len);
  napi_get_value_string_utf8(env, args[0], fen.data(), len+1, &len);
  // depth
  int32_t depth = 0; napi_get_value_int32(env, args[1], &depth);
  engine::Position pos; if (!engine::parse_fen(fen, pos)) {
    return ThrowType(env, "invalid FEN");
  }
  std::uint64_t nodes = engine::perft(pos, depth);
  napi_value out;
  // Prefer BigInt when supported
  #ifdef NAPI_EXPERIMENTAL
  napi_create_bigint_uint64(env, nodes, &out);
  #else
  // May lose precision for very large counts; acceptable for small depths.
  napi_create_double(env, static_cast<double>(nodes), &out);
  #endif
  return out;
}

static napi_value LegalMoves(napi_env env, napi_callback_info info){
  size_t argc=1; napi_value args[1]; napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  if (argc < 1) return ThrowType(env, "legalMoves expects (fen)");
  size_t len; napi_get_value_string_utf8(env, args[0], nullptr, 0, &len);
  std::string fen; fen.resize(len);
  napi_get_value_string_utf8(env, args[0], fen.data(), len+1, &len);
  auto moves = engine::legal_moves_uci(fen);
  napi_value arr; napi_create_array_with_length(env, (int)moves.size(), &arr);
  for (size_t i=0;i<moves.size();++i){
    napi_value s; napi_create_string_utf8(env, moves[i].c_str(), NAPI_AUTO_LENGTH, &s);
    napi_set_element(env, arr, (uint32_t)i, s);
  }
  return arr;
}

static napi_value Init(napi_env env, napi_value exports){
  napi_property_descriptor desc[] = {
    { "choose", 0, Choose, 0, 0, 0, napi_default, 0 },
    { "perft", 0, Perft, 0, 0, 0, napi_default, 0 },
    { "legalMoves", 0, LegalMoves, 0, 0, 0, napi_default, 0 }
  };
  napi_define_properties(env, exports, sizeof(desc)/sizeof(desc[0]), desc);
  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
