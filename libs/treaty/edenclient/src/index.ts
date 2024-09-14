/**
 * @module
 *
 * This module implements a client for the Elysia framework, providing utilities for creating observable-based API clients with TypeScript. It includes type-safe utilities for handling files, making HTTP requests, and processing responses. It leverages RxJS for observables and integrates with Angular's HttpClient for HTTP requests. Key features include type-safe route definition, detailed error handling, and support for file uploads.
 *
 * Example usage:
 * ```ts
 * import { edenClient } from "@treaty/httpclient@0.0";
 * const client = edenClient<MyAppSchema>('http://api.example.com');
 * ```
 */

import type { Elysia } from 'elysia'
import { EdenClient } from './lib/types'
import { catchError, of } from 'rxjs'
import { EdenFetchError } from './lib/error'
import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http'
import { assertInInjectionContext, inject } from '@angular/core'
import { composePath } from './lib/utils/other'

// @ts-ignore
const isServer = typeof FileList === 'undefined'

/**
 * Determines if the provided value is a File or FileList, facilitating the handling of file inputs.
 * @param v The value to check.
 * @returns A boolean indicating whether the value is a File or FileList.
 */
const isFile = (v: any) => {
	// @ts-ignore
	if (isServer) {
		return v instanceof Blob
	} else {
		// @ts-ignore
		return v instanceof FileList || v instanceof File
	}
}

/**
 * Checks if the given object contains a File or FileList, aiding in detecting file inputs within objects.
 * FormData is 1 level deep
 * @param obj The object to check.
 * @returns A boolean indicating if the object contains a File or FileList.
 */
const hasFile = (obj: Record<string, any>) => {
	if (!obj) return false

	for (const key in obj) {
		if (isFile(obj[key])) return true
		else if (
			Array.isArray(obj[key]) &&
			(obj[key] as unknown[]).find((x) => isFile(x))
		)
			return true
	}

	return false
}


/**
 * Creates a new File instance from a given File, useful in environments where FileList is not defined.
 * @param v The File to convert.
 * @returns A Promise resolving to a File.
 */
// @ts-ignore
const createNewFile = (v: File) =>
	isServer
		? v
		: new Promise<File>((resolve) => {
			// @ts-ignore
			const reader = new FileReader()

			reader.onload = () => {
				const file = new File([reader.result!], v.name, {
					lastModified: v.lastModified,
					type: v.type
				})
				resolve(file)
			}

			reader.readAsArrayBuffer(v)
		})


/**
* Creates a proxy for making HTTP requests to a specified domain, utilizing Angular's HttpClient.
* @param domain The base domain for the API.
* @param path Initial path segment for the API endpoint.
* @param httpClient An instance of Angular's HttpClient.
* @returns A proxy object for making API requests.
*/
const createProxy = (
	domain: string,
	path = '',
	httpClient: HttpClient
): Record<string, any> => {
	return new Proxy(() => { }, {
		get(_, key: string) {
			return createProxy(domain, `${path}/${key}`, httpClient);
		},
		apply(_, __, [initialBody = {}, options = {}]: [
			{
				$query?: Record<string, string>,
				$headers?: Record<string, string>,
			},
			any
		]) {
			const { $query, $headers, ...body } = initialBody;
			const i = path.lastIndexOf('/'),
				method = path.slice(i + 1),
				endpoint = composePath(
					domain,
					i === -1 ? '/' : path.slice(0, i),
					Object.assign(options.query ?? {}, $query)
				)

			const httpOptions = {
				headers: new HttpHeaders($headers),
			};

			const errorHandler = catchError((error: HttpErrorResponse) => {
				return of(new EdenFetchError(error.status, error.message))
			})

			switch (method) {
				case 'get':
					return httpClient.get(endpoint, httpOptions as any).pipe(errorHandler);
				case 'post':
					return httpClient.post(endpoint, body, httpOptions as any).pipe(errorHandler);
				case 'put':
					return httpClient.put(endpoint, body, httpOptions as any).pipe(errorHandler);
				case 'delete':
					return httpClient.delete(endpoint, httpOptions as any).pipe(errorHandler);
				default:
					throw new Error(`Method ${method.toUpperCase()} is not supported`);
			}
		}
	});
};

/**
 * Initializes an EdenClient for interacting with an Elysia-based API.
 * @param domain The base URL of the API.
 * @returns An instance of EdenClient configured for the specified Elysia application.
 */
export const edenClient = <App extends Elysia<any, any, any, any, any, any>>(
	domain: string,
): EdenClient.Create<App> => {
	assertInInjectionContext(() => `edenClient can only be called inside of the constuctor context`)
	const httpClient = inject(HttpClient)
	return new Proxy(
		{},
		{
			get(target, key) {
				return createProxy(domain, key as string, httpClient)
			}
		}
	) as any
}