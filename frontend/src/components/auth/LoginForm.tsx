import { useState, type FC } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, useNavigate } from 'react-router-dom';
import { z } from 'zod';
import type { AxiosError } from 'axios';
import useAuth from '../../hooks/useAuth';

const loginSchema = z.object({
    email: z.string().email('Please enter a valid email address'),
    password: z.string().min(6, 'Password must be at least 6 characters'),
});

type LoginFormValues = z.infer<typeof loginSchema>;

type ApiErrorResponse = {
    message?: string;
};

const LoginForm: FC = () => {
    const navigate = useNavigate();
    const { login, isLoading } = useAuth();
    const [submitError, setSubmitError] = useState<string | null>(null);

    const {
        register,
        handleSubmit,
        formState: { errors, isSubmitting },
    } = useForm<LoginFormValues>({
        resolver: zodResolver(loginSchema),
        mode: 'onTouched',
    });

    const onSubmit = async (values: LoginFormValues) => {
        setSubmitError(null);

        try {
            await login(values.email, values.password);
            navigate('/dashboard', { replace: true });
        } catch (error) {
            const apiError = error as AxiosError<ApiErrorResponse>;
            setSubmitError(apiError.response?.data?.message ?? 'Invalid email or password');
        }
    };

    const isFormBusy = isSubmitting || isLoading;

    return (
        <div className="w-full max-w-md rounded-xl border border-gray-200 bg-white p-8 shadow-xl">
            <div className="mb-8 text-center">
                <h1 className="text-2xl font-bold text-gray-900">Welcome Back</h1>
                <p className="mt-2 text-gray-500">Sign in to continue to your dashboard</p>
            </div>

            <form onSubmit={handleSubmit(onSubmit)} className="space-y-5" noValidate>
                <div>
                    <label htmlFor="email" className="mb-1 block text-sm font-medium text-gray-700">
                        Email Address
                    </label>
                    <input
                        id="email"
                        type="email"
                        {...register('email')}
                        className="w-full rounded-lg border border-gray-300 px-4 py-2 outline-none transition-all focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
                        placeholder="you@company.com"
                        disabled={isFormBusy}
                    />
                    {errors.email && <p className="mt-1 text-xs text-red-500">{errors.email.message}</p>}
                </div>

                <div>
                    <div className="mb-1 flex items-center justify-between">
                        <label htmlFor="password" className="block text-sm font-medium text-gray-700">
                            Password
                        </label>
                        <Link to="/forgot-password" className="text-xs font-medium text-blue-600 hover:underline">
                            Forgot Password?
                        </Link>
                    </div>
                    <input
                        id="password"
                        type="password"
                        {...register('password')}
                        className="w-full rounded-lg border border-gray-300 px-4 py-2 outline-none transition-all focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
                        placeholder="••••••••"
                        disabled={isFormBusy}
                    />
                    {errors.password && <p className="mt-1 text-xs text-red-500">{errors.password.message}</p>}
                </div>

                {submitError && (
                    <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                        {submitError}
                    </div>
                )}

                <button
                    type="submit"
                    disabled={isFormBusy}
                    className="w-full rounded-lg bg-blue-600 py-2.5 font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                    {isFormBusy ? 'Signing in...' : 'Sign In'}
                </button>
            </form>

            <div className="mt-6 text-center text-sm">
                <span className="text-gray-600">Don’t have an account? </span>
                <Link to="/register" className="font-medium text-blue-600 hover:underline">
                    Sign Up
                </Link>
            </div>
        </div>
    );
};

export default LoginForm;
