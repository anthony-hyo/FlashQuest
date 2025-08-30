/*
 * Copyright (c) 2025 Anthony S. All rights reserved.
 */

const path = require('path');

module.exports = {
	entry: {
		'/public/js/app.js': [
			'./src/index.ts',
		]
	},
	output: {
		filename: '[name]',
		path: path.resolve(__dirname),
	},
	resolve: {
		extensions: ['.ts', '.js', '.scss'],
	},
	module: {
		rules: [
			{
				test: /\.tsx?$/,
				use: 'ts-loader',
				exclude: /node_modules/,
			}
		],
	},
	devtool: 'source-map',
};
