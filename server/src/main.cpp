#define _WINSOCK_DEPRECATED_NO_WARNINGS
#include <winsock2.h>
#include <ws2tcpip.h>
#include <windows.h>

#include <algorithm>
#include <chrono>
#include <cstdint>
#include <cstdio>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <map>
#include <mutex>
#include <optional>
#include <string>
#include <thread>
#include <vector>

#pragma comment(lib, "Ws2_32.lib")

namespace fs = std::filesystem;

static const char* kDefaultRoot = "manual_test_env/web";
static const int kDefaultPort = 8080;

struct Request {
    std::string method;
    std::string path;
    std::map<std::string, std::string> headers;
};

static std::string to_lower(std::string s) {
    std::transform(s.begin(), s.end(), s.begin(), [](unsigned char c){ return (char)std::tolower(c); });
    return s;
}

static std::string guess_content_type(const fs::path& p) {
    auto ext = to_lower(p.extension().string());
    if (ext == ".html" || ext == ".htm") return "text/html; charset=utf-8";
    if (ext == ".js") return "text/javascript; charset=utf-8";
    if (ext == ".mjs") return "text/javascript; charset=utf-8";
    if (ext == ".css") return "text/css; charset=utf-8";
    if (ext == ".json") return "application/json; charset=utf-8";
    if (ext == ".wasm") return "application/wasm";
    if (ext == ".png") return "image/png";
    if (ext == ".jpg" || ext == ".jpeg") return "image/jpeg";
    if (ext == ".gif") return "image/gif";
    if (ext == ".svg") return "image/svg+xml";
    if (ext == ".txt") return "text/plain; charset=utf-8";
    return "application/octet-stream";
}

static std::string http_date() {
    char buf[128];
    SYSTEMTIME st; GetSystemTime(&st);
    static const char* wdays[] = {"Sun","Mon","Tue","Wed","Thu","Fri","Sat"};
    static const char* mons[] = {"Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"};
    std::snprintf(buf, sizeof(buf), "%s, %02d %s %04d %02d:%02d:%02d GMT",
        wdays[(st.wDayOfWeek)%7], st.wDay, mons[(st.wMonth-1)%12], st.wYear,
        st.wHour, st.wMinute, st.wSecond);
    return std::string(buf);
}

static bool starts_with(const std::string& s, const std::string& p) {
    return s.size() >= p.size() && std::equal(p.begin(), p.end(), s.begin());
}

static std::string url_decode(const std::string& in) {
    std::string out; out.reserve(in.size());
    for (size_t i=0; i<in.size(); ++i) {
        if (in[i] == '%' && i+2 < in.size()) {
            auto hex = in.substr(i+1,2);
            char* end=nullptr;
            long v = std::strtol(hex.c_str(), &end, 16);
            if (end && *end == '\0') { out.push_back((char)v); i+=2; continue; }
        }
        else if (in[i] == '+') { out.push_back(' '); continue; }
        out.push_back(in[i]);
    }
    return out;
}

static fs::path sanitize_path(const fs::path& root, std::string url_path) {
    // Strip query/hash
    if (auto qpos = url_path.find('?'); qpos != std::string::npos) url_path.resize(qpos);
    if (auto hpos = url_path.find('#'); hpos != std::string::npos) url_path.resize(hpos);
    // Decode and normalize
    url_path = url_decode(url_path);
    // Replace backslashes to avoid alternate separators
    std::replace(url_path.begin(), url_path.end(), '\\', '/');
    // Prevent path traversal
    fs::path joined = root / fs::path(url_path).relative_path();
    joined = fs::weakly_canonical(joined);
    auto canon_root = fs::weakly_canonical(root);
    auto jr = joined.string();
    auto rr = canon_root.string();
    // On Windows, comparison case-insensitive; normalize using lower
    auto jrL = to_lower(jr);
    auto rrL = to_lower(rr);
    if (!starts_with(jrL, rrL)) {
        return canon_root; // fallback to root
    }
    return joined;
}

static std::optional<Request> parse_request(SOCKET client) {
    std::string data;
    char buf[4096];
    // Simple read until CRLF CRLF or buffer limit
    for (;;) {
        int n = recv(client, buf, sizeof(buf), 0);
        if (n <= 0) break;
        data.append(buf, buf + n);
        if (data.find("\r\n\r\n") != std::string::npos) break;
        if (data.size() > 1<<20) break; // 1MB guard
    }
    if (data.empty()) return std::nullopt;
    Request req;
    size_t lineEnd = data.find("\r\n");
    if (lineEnd == std::string::npos) return std::nullopt;
    std::string start = data.substr(0, lineEnd);
    {
        size_t p1 = start.find(' ');
        size_t p2 = (p1==std::string::npos) ? std::string::npos : start.find(' ', p1+1);
        if (p1==std::string::npos || p2==std::string::npos) return std::nullopt;
        req.method = start.substr(0, p1);
        req.path = start.substr(p1+1, p2-p1-1);
    }
    size_t pos = lineEnd + 2;
    while (true) {
        size_t next = data.find("\r\n", pos);
        if (next == std::string::npos) break;
        if (next == pos) break; // empty line
        std::string header = data.substr(pos, next-pos);
        pos = next + 2;
        auto colon = header.find(':');
        if (colon != std::string::npos) {
            auto key = to_lower(header.substr(0, colon));
            auto val = header.substr(colon+1);
            // trim spaces
            val.erase(val.begin(), std::find_if(val.begin(), val.end(), [](unsigned char c){return !std::isspace(c);}));
            val.erase(std::find_if(val.rbegin(), val.rend(), [](unsigned char c){return !std::isspace(c);}).base(), val.end());
            req.headers[key] = val;
        }
    }
    return req;
}

static void send_all(SOCKET s, const char* data, size_t len) {
    const char* p = data; size_t left = len;
    while (left) {
        int sent = send(s, p, (int)std::min(left, (size_t)INT32_MAX), 0);
        if (sent <= 0) break;
        p += sent; left -= sent;
    }
}

static void respond_404(SOCKET client) {
    std::string body = "Not Found";
    std::string hdr =
        "HTTP/1.1 404 Not Found\r\n"
        "Date: " + http_date() + "\r\n"
        "Content-Type: text/plain; charset=utf-8\r\n"
        "Content-Length: " + std::to_string(body.size()) + "\r\n"
        "Cross-Origin-Opener-Policy: same-origin\r\n"
        "Cross-Origin-Embedder-Policy: require-corp\r\n"
        "Cross-Origin-Resource-Policy: same-origin\r\n"
        "X-Content-Type-Options: nosniff\r\n"
        "Connection: close\r\n\r\n";
    send_all(client, hdr.c_str(), hdr.size());
    send_all(client, body.c_str(), body.size());
}

static void respond_405(SOCKET client) {
    std::string body = "Method Not Allowed";
    std::string hdr =
        "HTTP/1.1 405 Method Not Allowed\r\n"
        "Allow: GET, HEAD\r\n"
        "Date: " + http_date() + "\r\n"
        "Content-Type: text/plain; charset=utf-8\r\n"
        "Content-Length: " + std::to_string(body.size()) + "\r\n"
        "Cross-Origin-Opener-Policy: same-origin\r\n"
        "Cross-Origin-Embedder-Policy: require-corp\r\n"
        "Cross-Origin-Resource-Policy: same-origin\r\n"
        "X-Content-Type-Options: nosniff\r\n"
        "Connection: close\r\n\r\n";
    send_all(client, hdr.c_str(), hdr.size());
    send_all(client, body.c_str(), body.size());
}

static void respond_file(SOCKET client, const fs::path& f, const std::string& method) {
    std::error_code ec;
    auto size = fs::file_size(f, ec);
    if (ec) { respond_404(client); return; }
    std::string ctype = guess_content_type(f);

    std::string hdr =
        "HTTP/1.1 200 OK\r\n"
        "Date: " + http_date() + "\r\n"
        "Content-Type: " + ctype + "\r\n"
        "Content-Length: " + std::to_string(size) + "\r\n"
        "Cross-Origin-Opener-Policy: same-origin\r\n"
        "Cross-Origin-Embedder-Policy: require-corp\r\n"
        "Cross-Origin-Resource-Policy: same-origin\r\n"
        "X-Content-Type-Options: nosniff\r\n"
        "Cache-Control: no-cache\r\n"
        "Connection: close\r\n\r\n";
    send_all(client, hdr.c_str(), hdr.size());
    if (to_lower(method) == "head") return;

    std::ifstream ifs(f, std::ios::binary);
    char buf[64*1024];
    while (ifs) {
        ifs.read(buf, sizeof(buf));
        std::streamsize n = ifs.gcount();
        if (n > 0) send_all(client, buf, (size_t)n);
    }
}

static void handle_client(SOCKET client, fs::path root) {
    auto reqOpt = parse_request(client);
    if (!reqOpt.has_value()) { closesocket(client); return; }
    auto req = std::move(reqOpt.value());

    if (req.method != "GET" && req.method != "HEAD") {
        respond_405(client);
        closesocket(client);
        return;
    }

    std::string urlPath = req.path.empty() ? "/" : req.path;
    if (urlPath == "/") urlPath = "/index.html";
    fs::path filePath = sanitize_path(root, urlPath);

    if (!fs::exists(filePath) || fs::is_directory(filePath)) {
        respond_404(client);
        closesocket(client);
        return;
    }

    respond_file(client, filePath, req.method);
    closesocket(client);
}

int main(int argc, char** argv) {
    int port = kDefaultPort;
    fs::path root = kDefaultRoot;

    if (const char* envRoot = std::getenv("CHESS_SERVER_ROOT")) {
        root = envRoot;
    }
    if (const char* envPort = std::getenv("CHESS_SERVER_PORT")) {
        try { port = std::stoi(envPort); } catch (...) {}
    }
    if (argc >= 2) { try { port = std::stoi(argv[1]); } catch (...) {} }
    if (argc >= 3) { root = argv[2]; }

    WSADATA wsaData;
    if (WSAStartup(MAKEWORD(2,2), &wsaData) != 0) {
        std::cerr << "WSAStartup failed\n";
        return 1;
    }

    SOCKET server = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    if (server == INVALID_SOCKET) {
        std::cerr << "socket() failed\n";
        WSACleanup();
        return 1;
    }

    BOOL yes = 1;
    setsockopt(server, SOL_SOCKET, SO_REUSEADDR, (const char*)&yes, sizeof(yes));

    sockaddr_in addr{};
    addr.sin_family = AF_INET;
    addr.sin_addr.s_addr = htonl(INADDR_ANY);
    addr.sin_port = htons((u_short)port);

    if (bind(server, (sockaddr*)&addr, sizeof(addr)) == SOCKET_ERROR) {
        std::cerr << "bind() failed on port " << port << "\n";
        closesocket(server);
        WSACleanup();
        return 1;
    }
    if (listen(server, SOMAXCONN) == SOCKET_ERROR) {
        std::cerr << "listen() failed\n";
        closesocket(server);
        WSACleanup();
        return 1;
    }

    std::error_code ec;
    root = fs::weakly_canonical(root, ec);
    if (ec || !fs::exists(root)) {
        std::cerr << "Root not found: " << root.string() << "\n";
        closesocket(server);
        WSACleanup();
        return 1;
    }

    std::cout << "Serving " << root.string() << " on http://127.0.0.1:" << port << "\n";
    std::cout << "Headers: COOP=same-origin, COEP=require-corp, CORP=same-origin\n";

    for (;;) {
        sockaddr_in caddr{}; int clen = sizeof(caddr);
        SOCKET client = accept(server, (sockaddr*)&caddr, &clen);
        if (client == INVALID_SOCKET) continue;
        std::thread([client, root]{ handle_client(client, root); }).detach();
    }

    // Unreachable in this simple server
    closesocket(server);
    WSACleanup();
    return 0;
}
