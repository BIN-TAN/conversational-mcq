/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    return {
      // Instructor sign-in at /teacher/login. The page lives outside app/teacher so the
      // teacher layout (which sends signed-out visitors here) does not wrap it.
      beforeFiles: [{ source: "/teacher/login", destination: "/instructor-login" }]
    };
  }
};

export default nextConfig;
