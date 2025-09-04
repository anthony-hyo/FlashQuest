const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');

module.exports = (env, argv) => {
	const isProduction = argv.mode === 'production';
	
	return {
		entry: './src/index.ts',
		mode: argv.mode || 'development',
		devtool: isProduction ? 'source-map' : 'inline-source-map',
		module: {
			rules: [
				{
					test: /\.tsx?$/,
					use: 'ts-loader',
					exclude: /node_modules/,
				},
			],
		},
		resolve: {
			extensions: ['.tsx', '.ts', '.js'],
			fallback: {
				"buffer": false,
				"crypto": false,
				"stream": false,
				"util": false,
				"zlib": false
			}
		},
		output: {
			filename: isProduction ? '[name].[contenthash].js' : 'bundle.js',
			path: path.resolve(__dirname, 'dist'),
			clean: true,
			library: 'SWFRenderer',
			libraryTarget: 'umd',
			globalObject: 'this'
		},
		plugins: [
			new HtmlWebpackPlugin({
				template: './public/index.html',
				inject: 'head',
				scriptLoading: 'blocking'
			}),
		],
		devServer: {
			static: './dist',
			port: 3000,
			host: '0.0.0.0',
			hot: true,
			open: true,
			historyApiFallback: true,
			headers: {
				'Cross-Origin-Embedder-Policy': 'require-corp',
				'Cross-Origin-Opener-Policy': 'same-origin'
			}
		},
		optimization: {
			splitChunks: isProduction ? {
				chunks: 'all',
				cacheGroups: {
					vendor: {
						test: /[\\/]node_modules[\\/]/,
						name: 'vendors',
						chunks: 'all',
					},
				},
			} : false
		}
	};
};
